/**
 * Generic Manga Adapter - Universal fallback for unsupported sites
 * 
 * Uses heuristics, layout analysis, and computer vision to detect
 * manga content on any website without site-specific selectors.
 * 
 * @module content/site-adapters/generic-manga-adapter
 */

import { MangaAdapter } from './base-adapter.js';
import { DOMHelpers } from '../../shared/utils/dom-helpers.js';
import { ImageUtils } from '../../shared/utils/image-utils.js';
import { PerformanceMonitor } from '../../shared/utils/performance-monitor.js';

/**
 * Heuristic-based generic manga detector
 * Analyzes page structure, image characteristics, and reading patterns
 */
export class GenericMangaAdapter extends MangaAdapter {
  constructor() {
    super();
    this.platform = 'generic';
    this.priority = 0; // Lowest priority, fallback only
    
    // Detection confidence thresholds
    this.thresholds = {
      minMangaScore: 0.6,
      minImageAspectRatio: 0.5,
      maxImageAspectRatio: 2.0,
      minImageWidth: 400,
      minImagesCount: 3
    };

    // Heuristic scoring weights
    this.weights = {
      aspectRatio: 0.25,
      imageCount: 0.20,
      sequentialNaming: 0.15,
      verticalLayout: 0.15,
      textDensity: 0.10,
      navigationPattern: 0.10,
      urlPattern: 0.05
    };

    this.analysisCache = null;
    this.imageSequence = [];
    this.readingDirection = 'rtl'; // Default manga reading direction
  }

  /**
   * Universal detection using heuristics
   * Returns confidence score 0-1
   */
  isMatch() {
    const score = this.calculateMangaProbability();
    console.log(`[GenericAdapter] Manga probability: ${(score * 100).toFixed(1)}%`);
    return score >= this.thresholds.minMangaScore;
  }

  /**
   * Calculate probability that current page is manga using multiple heuristics
   */
  calculateMangaProbability() {
    const perfMark = PerformanceMonitor.mark('generic-detection');
    
    const signals = {
      aspectRatio: this.scoreAspectRatios(),
      imageCount: this.scoreImageCount(),
      sequentialNaming: this.scoreSequentialNaming(),
      verticalLayout: this.scoreVerticalLayout(),
      textDensity: this.scoreTextDensity(),
      navigationPattern: this.scoreNavigationPattern(),
      urlPattern: this.scoreUrlPattern()
    };

    let totalScore = 0;
    let totalWeight = 0;

    for (const [key, value] of Object.entries(signals)) {
      totalScore += value * this.weights[key];
      totalWeight += this.weights[key];
    }

    PerformanceMonitor.measure(perfMark, 'generic-detection-complete');
    
    // Normalize to 0-1
    return totalScore / totalWeight;
  }

  /**
   * Score based on image aspect ratios (manga typically tall/narrow)
   */
  scoreAspectRatios() {
    const images = this.getAllImages();
    if (images.length === 0) return 0;

    let mangaLikeCount = 0;
    const analyzed = images.slice(0, 20); // Sample first 20

    analyzed.forEach(img => {
      const ratio = img.naturalWidth / img.naturalHeight;
      // Manga pages usually 0.6-0.8 aspect ratio (taller than wide)
      if (ratio >= 0.5 && ratio <= 1.2) {
        mangaLikeCount++;
      }
    });

    return mangaLikeCount / analyzed.length;
  }

  /**
   * Score based on number of suitable images
   */
  scoreImageCount() {
    const images = this.getCandidateImages();
    if (images.length >= 10) return 1.0;
    if (images.length >= 5) return 0.8;
    if (images.length >= 3) return 0.6;
    if (images.length >= 1) return 0.3;
    return 0;
  }

  /**
   * Score based on sequential image naming (page_01.jpg, 001.png, etc.)
   */
  scoreSequentialNaming() {
    const images = this.getAllImages();
    const urls = images.map(img => {
      const src = img.src || img.dataset?.src || '';
      return src.split('/').pop()?.split('?')[0] || '';
    }).filter(Boolean);

    if (urls.length < 3) return 0;

    // Check for numeric sequences
    const numericPatterns = urls.map(url => {
      const matches = url.match(/\d+/g);
      return matches ? matches.join('') : '';
    }).filter(p => p.length > 0);

    if (numericPatterns.length < 3) return 0;

    // Check if numbers are sequential
    let sequentialCount = 0;
    for (let i = 1; i < numericPatterns.length; i++) {
      const prev = parseInt(numericPatterns[i - 1]);
      const curr = parseInt(numericPatterns[i]);
      if (curr === prev + 1 || curr === prev) {
        sequentialCount++;
      }
    }

    return Math.min(1, sequentialCount / (numericPatterns.length - 1));
  }

  /**
   * Score based on vertical layout (images stacked vertically)
   */
  scoreVerticalLayout() {
    const images = this.getCandidateImages();
    if (images.length < 2) return 0.5;

    let verticalCount = 0;
    for (let i = 1; i < images.length; i++) {
      const prev = images[i - 1].getBoundingClientRect();
      const curr = images[i].getBoundingClientRect();
      
      // Check if stacked vertically with small horizontal offset
      const verticalGap = curr.top - prev.bottom;
      const horizontalOffset = Math.abs(curr.left - prev.left);
      
      if (verticalGap > 0 && verticalGap < 200 && horizontalOffset < 100) {
        verticalCount++;
      }
    }

    return verticalCount / (images.length - 1);
  }

  /**
   * Score based on text density (manga has less text than articles)
   */
  scoreTextDensity() {
    const bodyText = document.body.innerText.length;
    const images = document.querySelectorAll('img').length;
    
    if (images === 0) return 0;
    
    const ratio = bodyText / images;
    // Manga pages typically have less text per image
    if (ratio < 100) return 1.0;
    if (ratio < 500) return 0.7;
    if (ratio < 1000) return 0.4;
    return 0.1;
  }

  /**
   * Score based on navigation elements (next/prev buttons)
   */
  scoreNavigationPattern() {
    const indicators = [
      'next', 'prev', 'previous', 'page', 'chapter',
      '下一页', '上一页', '次へ', '前へ'
    ];
    
    const elements = document.querySelectorAll('a, button, [role="button"]');
    let matchCount = 0;
    
    elements.forEach(el => {
      const text = (el.textContent + ' ' + el.className + ' ' + el.id).toLowerCase();
      if (indicators.some(ind => text.includes(ind))) {
        matchCount++;
      }
    });

    return Math.min(1, matchCount / 4);
  }

  /**
   * Score based on URL patterns
   */
  scoreUrlPattern() {
    const url = window.location.href.toLowerCase();
    const patterns = [
      /manga/i, /chapter/i, /read/i, /viewer/i,
      /manhua/i, /manhwa/i, /comic/i,
      /\/c\d+/i, /\/ch\d+/i, /\/page/i
    ];
    
    const matches = patterns.filter(p => p.test(url)).length;
    return Math.min(1, matches / 3);
  }

  /**
   * Initialize adapter with dynamic analysis
   */
  async initialize() {
    if (this.initialized) return;

    console.log('[GenericAdapter] Initializing heuristic analysis...');
    const perfMark = PerformanceMonitor.mark('generic-init');

    // Perform layout analysis
    this.analysisCache = await this.analyzePageLayout();
    
    // Determine reading direction
    this.readingDirection = this.detectReadingDirection();
    
    // Setup observers
    this.setupDynamicObservers();
    
    // Intercept image loads
    this.interceptImageLoading();

    this.initialized = true;
    PerformanceMonitor.measure(perfMark, 'generic-init-complete');

    this.emit('ready', {
      platform: this.platform,
      confidence: this.analysisCache.confidence,
      metadata: await this.extractMetadata(),
      layout: this.analysisCache
    });
  }

  /**
   * Comprehensive page layout analysis
   */
  async analyzePageLayout() {
    const images = this.getCandidateImages();
    const clusters = this.clusterImages(images);
    const mainCluster = this.findMainMangaCluster(clusters);

    return {
      confidence: this.calculateMangaProbability(),
      totalImages: images.length,
      mangaImages: mainCluster?.length || 0,
      clusters: clusters.length,
      mainCluster: mainCluster,
      container: this.findReaderContainer(mainCluster),
      readingDirection: this.readingDirection,
      hasInfiniteScroll: this.detectInfiniteScroll(),
      imageSequence: this.buildImageSequence(mainCluster)
    };
  }

  /**
   * Cluster images by spatial proximity
   */
  clusterImages(images) {
    if (images.length === 0) return [];
    
    const clusters = [];
    const threshold = 300; // pixels
    
    images.forEach(img => {
      const rect = img.getBoundingClientRect();
      let added = false;
      
      for (const cluster of clusters) {
        const lastImg = cluster[cluster.length - 1];
        const lastRect = lastImg.getBoundingClientRect();
        
        const distance = Math.abs(rect.top - lastRect.top) + 
                        Math.abs(rect.left - lastRect.left);
        
        if (distance < threshold) {
          cluster.push(img);
          added = true;
          break;
        }
      }
      
      if (!added) {
        clusters.push([img]);
      }
    });
    
    return clusters.sort((a, b) => b.length - a.length);
  }

  /**
   * Find the main manga image cluster (largest group of similar images)
   */
  findMainMangaCluster(clusters) {
    if (clusters.length === 0) return null;
    
    // Score clusters by manga-like characteristics
    const scored = clusters.map(cluster => {
      const avgWidth = cluster.reduce((sum, img) => sum + img.naturalWidth, 0) / cluster.length;
      const avgHeight = cluster.reduce((sum, img) => sum + img.naturalHeight, 0) / cluster.length;
      const aspectRatio = avgWidth / avgHeight;
      
      // Manga typically has consistent sizes and portrait orientation
      const sizeConsistency = this.calculateSizeConsistency(cluster);
      const isPortrait = aspectRatio < 1.2;
      
      const score = (cluster.length * 0.4) + 
                    (sizeConsistency * 0.3) + 
                    (isPortrait ? 0.3 : 0);
      
      return { cluster, score };
    });
    
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.cluster;
  }

  /**
   * Calculate size consistency within cluster
   */
  calculateSizeConsistency(cluster) {
    if (cluster.length < 2) return 1;
    
    const widths = cluster.map(img => img.naturalWidth);
    const heights = cluster.map(img => img.naturalHeight);
    
    const avgW = widths.reduce((a, b) => a + b) / widths.length;
    const avgH = heights.reduce((a, b) => a + b) / heights.length;
    
    const varianceW = widths.reduce((sum, w) => sum + Math.pow(w - avgW, 2), 0) / widths.length;
    const varianceH = heights.reduce((sum, h) => sum + Math.pow(h - avgH, 2), 0) / heights.length;
    
    const cvW = Math.sqrt(varianceW) / avgW; // Coefficient of variation
    const cvH = Math.sqrt(varianceH) / avgH;
    
    return Math.max(0, 1 - ((cvW + cvH) / 2));
  }

  /**
   * Find common container for image cluster
   */
  findReaderContainer(images) {
    if (!images || images.length === 0) return document.body;
    
    // Find common ancestor
    let container = images[0].parentElement;
    const paths = images.map(img => DOMHelpers.getPath(img));
    
    while (container && container !== document.body) {
      const containsAll = images.every(img => container.contains(img));
      if (containsAll) break;
      container = container.parentElement;
    }
    
    return container || document.body;
  }

  /**
   * Detect if site uses infinite scroll
   */
  detectInfiniteScroll() {
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = window.innerHeight;
    const images = this.getCandidateImages();
    
    // If page is very long with many images, likely infinite scroll
    return (scrollHeight > clientHeight * 3) && (images.length > 20);
  }

  /**
   * Build ordered sequence of manga pages
   */
  buildImageSequence(images) {
    if (!images) return [];
    
    // Sort by visual reading order (top-to-bottom, then RTL or LTR)
    return images.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      
      // Group by rows (approximate)
      const rowThreshold = 100;
      const sameRow = Math.abs(rectA.top - rectB.top) < rowThreshold;
      
      if (sameRow) {
        // Same row: use reading direction
        return this.readingDirection === 'rtl' ? 
          rectB.left - rectA.left : 
          rectA.left - rectB.left;
      }
      
      // Different rows: top to bottom
      return rectA.top - rectB.top;
    });
  }

  /**
   * Detect reading direction (RTL for manga, LTR for comics)
   */
  detectReadingDirection() {
    const url = window.location.href.toLowerCase();
    
    // Strong indicators for RTL (Japanese manga)
    if (/manga|manhua|raw|chapter.*\d+/i.test(url)) return 'rtl';
    
    // Check image ordering
    const images = this.getCandidateImages().slice(0, 5);
    if (images.length >= 2) {
      const positions = images.map(img => img.getBoundingClientRect().left);
      // If generally decreasing, likely RTL
      let decreasing = 0;
      for (let i = 1; i < positions.length; i++) {
        if (positions[i] < positions[i-1]) decreasing++;
      }
      if (decreasing > positions.length / 2) return 'rtl';
    }
    
    return 'ltr';
  }

  /**
   * Get all images on page
   */
  getAllImages() {
    return Array.from(document.querySelectorAll('img'));
  }

  /**
   * Get candidate manga images (filtered by size/position)
   */
  getCandidateImages() {
    const all = this.getAllImages();
    
    return all.filter(img => {
      const rect = img.getBoundingClientRect();
      const width = img.naturalWidth || rect.width;
      const height = img.naturalHeight || rect.height;
      const aspectRatio = width / height;
      
      // Filter out icons, thumbnails, ads
      return (
        width >= this.thresholds.minImageWidth &&
        aspectRatio >= this.thresholds.minImageAspectRatio &&
        aspectRatio <= this.thresholds.maxImageAspectRatio &&
        rect.top < document.documentElement.scrollHeight * 0.9 && // Not footer
        !img.closest('nav, header, .advertisement, [class*="ad-"]') // Not in nav/header/ads
      );
    });
  }

  /**
   * Get current image elements (for processing)
   */
  getImageElements() {
    if (!this.analysisCache) {
      return this.getCandidateImages();
    }
    return this.analysisCache.imageSequence || this.getCandidateImages();
  }

  /**
   * Extract metadata using heuristics
   */
  async extractMetadata() {
    const url = window.location.href;
    
    return {
      platform: this.platform,
      url: url,
      title: this.extractGenericTitle(),
      chapter: this.extractGenericChapter(),
      confidence: this.analysisCache?.confidence || 0,
      readingDirection: this.readingDirection,
      pageCount: this.getImageElements().length,
      detectionMethod: 'heuristic'
    };
  }

  /**
   * Extract title from page heuristics
   */
  extractGenericTitle() {
    // Try common selectors
    const selectors = [
      'h1', 'h2', '.title', '[class*="title"]', 
      '[class*="manga"]', '[class*="chapter"]'
    ];
    
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (text.length > 3 && text.length < 100) {
          // Clean up common suffixes
          return text.replace(/ - (Read|Chapter|Page).*$/, '').trim();
        }
      }
    }
    
    // Fallback to page title
    return document.title.replace(/ - .*$/, '').trim() || 'Unknown Title';
  }

  /**
   * Extract chapter info from URL and page
   */
  extractGenericChapter() {
    const url = window.location.href;
    const patterns = [
      /[/_-]ch(?:apter)?[._-]?(\d+(?:\.\d+)?)/i,
      /[/_-]c(\d+(?:\.\d+)?)/i,
      /[/_-]vol(?:ume)?[._-]?(\d+)/i,
      /[/_-]page[._-]?(\d+)/i
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return { number: parseFloat(match[1]), id: match[1] };
    }
    
    // Try to find in page text
    const text = document.body.innerText;
    const textMatch = text.match(/Chapter\s*(\d+(?:\.\d+)?)/i);
    if (textMatch) return { number: parseFloat(textMatch[1]), id: textMatch[1] };
    
    return { number: null, id: null };
  }

  /**
   * Setup observers for dynamic content
   */
  setupDynamicObservers() {
    // Watch for new images (infinite scroll)
    const observer = new MutationObserver((mutations) => {
      let hasNewImages = false;
      
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const images = node.matches?.('img') ? [node] : 
                          node.querySelectorAll?.('img') || [];
            
            images.forEach(img => {
              if (this.isCandidateImage(img)) {
                hasNewImages = true;
                this.handleNewImage(img);
              }
            });
          }
        });
      });
      
      if (hasNewImages) {
        // Re-analyze layout
        this.analysisCache = this.analyzePageLayout();
        this.emit('layoutUpdated', this.analysisCache);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    this.observers.set('dynamic', observer);
  }

  /**
   * Check if image passes candidate filters
   */
  isCandidateImage(img) {
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    const aspect = width / height;
    
    return (
      width > this.thresholds.minImageWidth &&
      aspect > this.thresholds.minImageAspectRatio &&
      aspect < this.thresholds.maxImageAspectRatio
    );
  }

  /**
   * Handle new image detection
   */
  handleNewImage(img) {
    if (this.processedImages.has(img)) return;
    
    img.addEventListener('load', () => {
      this.emit('imageLoaded', {
        image: img,
        src: img.src,
        isManga: this.isCandidateImage(img)
      });
    }, { once: true });
  }

  /**
   * Navigate to next page (heuristic)
   */
  async nextPage() {
    // Try common next buttons
    const nextSelectors = [
      'a[rel="next"]', 'a[aria-label="Next"]',
      'button:contains("Next")', '.next',
      '[class*="next"]', '[id*="next"]',
      'a[href*="page="][href*="next"]'
    ];
    
    for (const sel of nextSelectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        btn.click();
        return true;
      }
    }
    
    // Fallback: scroll to next image
    const images = this.getImageElements();
    const current = this.getCurrentViewportImage();
    const currentIndex = images.indexOf(current);
    
    if (currentIndex >= 0 && currentIndex < images.length - 1) {
      images[currentIndex + 1].scrollIntoView({ behavior: 'smooth' });
      return true;
    }
    
    return false;
  }

  /**
   * Get image currently in viewport
   */
  getCurrentViewportImage() {
    const images = this.getImageElements();
    const viewportCenter = window.scrollY + window.innerHeight / 2;
    
    return images.reduce((closest, img) => {
      const rect = img.getBoundingClientRect();
      const imgCenter = rect.top + rect.height / 2;
      const distance = Math.abs(viewportCenter - imgCenter);
      
      return distance < closest.distance ? { img, distance } : closest;
    }, { img: null, distance: Infinity }).img;
  }

  /**
   * Get current page number (estimated)
   */
  getCurrentPage() {
    const current = this.getCurrentViewportImage();
    const images = this.getImageElements();
    const index = images.indexOf(current);
    return index >= 0 ? index + 1 : 1;
  }

  /**
   * Get total pages
   */
  getTotalPages() {
    return this.getImageElements().length;
  }

  /**
   * Cleanup
   */
  destroy() {
    super.destroy();
    this.analysisCache = null;
    this.imageSequence = [];
  }
}

// Export singleton
export const genericAdapter = new GenericMangaAdapter();
export default genericAdapter;