/**
 * panel-segmenter.js
 * 
 * Manga panel detection and segmentation using computer vision techniques.
 * Detects panel boundaries, reading order, and creates isolated panel images.
 * Supports both traditional manga (right-to-left) and webtoon (vertical scroll) formats.
 */

import { PerformanceMonitor } from '../../shared/utils/performance-monitor.js';

/**
 * Configuration for panel segmentation
 */
const PANEL_CONFIG = {
  // Detection parameters
  MIN_PANEL_AREA_RATIO: 0.01,      // Minimum panel size (1% of page)
  MAX_PANEL_AREA_RATIO: 0.95,      // Maximum panel size (95% of page)
  GAP_THRESHOLD: 15,               // Minimum gap between panels (pixels)
  BORDER_SENSITIVITY: 30,          // Edge detection sensitivity
  
  // Line detection
  MIN_LINE_LENGTH: 50,             // Minimum line length to consider
  LINE_MERGE_THRESHOLD: 10,        // Pixels to merge nearby lines
  
  // Shape analysis
  ASPECT_RATIO_MIN: 0.1,           // Min width/height ratio
  ASPECT_RATIO_MAX: 10,            // Max width/height ratio
  RECTANGLE_TOLERANCE: 0.2,        // How much panels can deviate from perfect rectangles
  
  // Content detection
  CONTENT_THRESHOLD: 0.02,         // Minimum ink density to consider as content
  
  // Performance
  DOWNSAMPLE_MAX_DIM: 1200,        // Max dimension for processing
  USE_WASM: true,                  // Use WASM acceleration if available
  
  // Reading order
  READING_DIRECTION: 'rtl',        // 'rtl' (manga) or 'ltr' (comics) or 'ttb' (webtoon)
  READING_ORDER_ALGORITHM: 'z-pattern' // 'z-pattern', 'column-major', 'row-major'
};

/**
 * Represents a detected manga panel
 */
export class MangaPanel {
  constructor(bounds, metadata = {}) {
    this.x = Math.round(bounds.x);
    this.y = Math.round(bounds.y);
    this.width = Math.round(bounds.width);
    this.height = Math.round(bounds.height);
    this.id = metadata.id || crypto.randomUUID();
    this.confidence = metadata.confidence || 0;
    this.type = metadata.type || 'standard'; // 'standard', 'inset', 'full-bleed', 'borderless'
    this.contentBounds = metadata.contentBounds || null;
    this.inkDensity = metadata.inkDensity || 0;
    this.neighbors = {
      top: null,
      bottom: null,
      left: null,
      right: null
    };
    this.readingOrder = -1;
  }

  get area() {
    return this.width * this.height;
  }

  get center() {
    return {
      x: this.x + this.width / 2,
      y: this.y + this.height / 2
    };
  }

  get bounds() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height
    };
  }

  /**
   * Check if point is inside panel
   */
  contains(x, y) {
    return x >= this.x && x <= this.x + this.width &&
           y >= this.y && y <= this.y + this.height;
  }

  /**
   * Check overlap with another panel
   */
  overlaps(other, threshold = 0.1) {
    const xOverlap = Math.max(0, Math.min(this.x + this.width, other.x + other.width) - Math.max(this.x, other.x));
    const yOverlap = Math.max(0, Math.min(this.y + this.height, other.y + other.height) - Math.max(this.y, other.y));
    const overlapArea = xOverlap * yOverlap;
    const minArea = Math.min(this.area, other.area);
    return overlapArea / minArea > threshold;
  }

  /**
   * Expand bounds by margin
   */
  expand(margin) {
    return new MangaPanel({
      x: this.x - margin,
      y: this.y - margin,
      width: this.width + margin * 2,
      height: this.height + margin * 2
    }, { ...this, id: this.id });
  }

  /**
   * Crop image to panel bounds
   */
  async extractFromImage(image, padding = 0) {
    const canvas = new OffscreenCanvas(
      this.width + padding * 2,
      this.height + padding * 2
    );
    const ctx = canvas.getContext('2d');
    
    ctx.drawImage(
      image,
      Math.max(0, this.x - padding),
      Math.max(0, this.y - padding),
      this.width + padding * 2,
      this.height + padding * 2,
      0, 0,
      this.width + padding * 2,
      this.height + padding * 2
    );
    
    return await createImageBitmap(canvas);
  }
}

/**
 * Main panel segmenter class
 */
export class PanelSegmenter {
  constructor(config = {}) {
    this.config = { ...PANEL_CONFIG, ...config };
    this.performance = new PerformanceMonitor('PanelSegmenter');
    this.canvas = null;
    this.ctx = null;
    this._initCanvas();
  }

  _initCanvas() {
    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(1, 1);
    } else {
      this.canvas = document.createElement('canvas');
    }
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  /**
   * Main entry: segment page into panels
   */
  async segment(image, options = {}) {
    this.performance.start('segment');
    const startTime = performance.now();
    
    try {
      // Setup dimensions
      const origWidth = image.width || image.naturalWidth;
      const origHeight = image.height || image.naturalHeight;
      
      // Downsample for processing
      const scale = Math.min(1, this.config.DOWNSAMPLE_MAX_DIM / Math.max(origWidth, origHeight));
      const procWidth = Math.floor(origWidth * scale);
      const procHeight = Math.floor(origHeight * scale);
      
      this.canvas.width = procWidth;
      this.canvas.height = procHeight;
      this.ctx.drawImage(image, 0, 0, procWidth, procHeight);
      
      const imageData = this.ctx.getImageData(0, 0, procWidth, procHeight);
      
      // Detect page layout type
      const layoutType = await this._detectLayoutType(imageData);
      
      // Choose segmentation strategy
      let panels = [];
      if (layoutType === 'webtoon' || options.forceWebtoon) {
        panels = await this._segmentWebtoon(imageData, scale);
      } else if (layoutType === 'grid') {
        panels = await this._segmentGridLayout(imageData, scale);
      } else {
        panels = await this._segmentTraditionalManga(imageData, scale);
      }
      
      // Post-processing
      panels = this._filterPanels(panels, procWidth * procHeight);
      panels = this._mergeOverlappingPanels(panels);
      panels = this._detectPanelTypes(panels, imageData);
      panels = this._determineReadingOrder(panels);
      panels = this._detectContentBounds(panels, imageData);
      
      // Scale back to original coordinates
      if (scale !== 1) {
        panels = panels.map(p => this._scalePanel(p, 1 / scale));
      }
      
      // Create segmentation result
      const result = new SegmentationResult({
        panels,
        layoutType,
        pageBounds: { x: 0, y: 0, width: origWidth, height: origHeight },
        processingTime: performance.now() - startTime,
        scaleFactor: scale
      });
      
      this.performance.end('segment');
      return result;
      
    } catch (error) {
      this.performance.end('segment');
      console.error('Panel segmentation failed:', error);
      throw error;
    }
  }

  /**
   * Detect if page is traditional manga, webtoon, or grid layout
   */
  async _detectLayoutType(imageData) {
    const { width, height, data } = imageData;
    
    // Analyze aspect ratio and content distribution
    const aspectRatio = width / height;
    
    // Webtoons are typically very tall
    if (aspectRatio < 0.3 && height > width * 3) {
      return 'webtoon';
    }
    
    // Check for regular grid patterns
    const horizontalLines = this._detectStrongLines(imageData, 'horizontal');
    const verticalLines = this._detectStrongLines(imageData, 'vertical');
    
    const gridScore = this._calculateGridScore(horizontalLines, verticalLines);
    if (gridScore > 0.7) {
      return 'grid';
    }
    
    return 'traditional';
  }

  /**
   * Segment traditional manga layout (complex nested panels)
   */
  async _segmentTraditionalManga(imageData, scale) {
    const { width, height, data } = imageData;
    
    // Step 1: Detect panel gutters (gaps between panels)
    const gutters = this._detectGutters(imageData);
    
    // Step 2: Find panel boundaries using gutter analysis
    const hBoundaries = this._findBoundariesFromGutters(gutters.horizontal, width, 'horizontal');
    const vBoundaries = this._findBoundariesFromGutters(gutters.vertical, height, 'vertical');
    
    // Step 3: Create initial panels from boundary intersections
    let panels = this._createPanelsFromBoundaries(hBoundaries, vBoundaries);
    
    // Step 4: Detect borderless panels using content analysis
    const borderlessPanels = await this._detectBorderlessPanels(imageData, panels);
    panels = [...panels, ...borderlessPanels];
    
    // Step 5: Detect inset panels (panels within panels)
    const insetPanels = this._detectInsetPanels(imageData, panels);
    panels = [...panels, ...insetPanels];
    
    return panels;
  }

  /**
   * Segment webtoon layout (vertical scrolling, full-width panels)
   */
  async _segmentWebtoon(imageData, scale) {
    const { width, height, data } = imageData;
    const panels = [];
    
    // Convert to grayscale and detect horizontal transitions
    const gray = this._toGrayscale(data);
    
    // Find horizontal gaps (panel separators)
    const rowDensity = new Array(height).fill(0);
    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      for (let x = 0; x < width; x++) {
        rowSum += gray[y * width + x];
      }
      rowDensity[y] = rowSum / (width * 255);
    }
    
    // Detect gap regions (low density)
    const gaps = [];
    let inGap = false;
    let gapStart = 0;
    const threshold = 0.02; // 2% ink density threshold
    
    for (let y = 0; y < height; y++) {
      if (rowDensity[y] < threshold && !inGap) {
        inGap = true;
        gapStart = y;
      } else if (rowDensity[y] >= threshold && inGap) {
        inGap = false;
        if (y - gapStart > this.config.GAP_THRESHOLD) {
          gaps.push({ start: gapStart, end: y, size: y - gapStart });
        }
      }
    }
    
    // Create panels from gaps
    let prevEnd = 0;
    for (const gap of gaps) {
      if (gap.start - prevEnd > this.config.MIN_LINE_LENGTH) {
        panels.push(new MangaPanel({
          x: 0,
          y: prevEnd,
          width: width,
          height: gap.start - prevEnd
        }, {
          type: 'webtoon-panel',
          confidence: 0.9
        }));
      }
      prevEnd = gap.end;
    }
    
    // Add final panel
    if (height - prevEnd > this.config.MIN_LINE_LENGTH) {
      panels.push(new MangaPanel({
        x: 0,
        y: prevEnd,
        width: width,
        height: height - prevEnd
      }, {
        type: 'webtoon-panel',
        confidence: 0.9
      }));
    }
    
    return panels;
  }

  /**
   * Segment grid-based layouts (4-koma, etc.)
   */
  async _segmentGridLayout(imageData, scale) {
    const { width, height } = imageData;
    
    // Detect strong lines
    const hLines = this._detectStrongLines(imageData, 'horizontal');
    const vLines = this._detectStrongLines(imageData, 'vertical');
    
    // Merge nearby lines
    const mergedH = this._mergeLines(hLines, this.config.LINE_MERGE_THRESHOLD);
    const mergedV = this._mergeLines(vLines, this.config.LINE_MERGE_THRESHOLD);
    
    // Create panels from line intersections
    const panels = [];
    for (let i = 0; i < mergedH.length - 1; i++) {
      for (let j = 0; j < mergedV.length - 1; j++) {
        const top = mergedH[i];
        const bottom = mergedH[i + 1];
        const left = mergedV[j];
        const right = mergedV[j + 1];
        
        const panelWidth = right - left;
        const panelHeight = bottom - top;
        
        // Validate panel size
        if (panelWidth > this.config.MIN_LINE_LENGTH && 
            panelHeight > this.config.MIN_LINE_LENGTH) {
          panels.push(new MangaPanel({
            x: left,
            y: top,
            width: panelWidth,
            height: panelHeight
          }, {
            type: 'grid-panel',
            confidence: 0.95,
            gridPosition: { row: i, col: j }
          }));
        }
      }
    }
    
    return panels;
  }

  /**
   * Detect gutters (gaps between panels)
   */
  _detectGutters(imageData) {
    const { width, height, data } = imageData;
    const gray = this._toGrayscale(data);
    
    // Horizontal gutter detection
    const hGutters = [];
    for (let y = 0; y < height; y++) {
      let gapPixels = 0;
      for (let x = 0; x < width; x++) {
        if (gray[y * width + x] > 240) gapPixels++;
      }
      if (gapPixels / width > 0.8) {
        hGutters.push(y);
      }
    }
    
    // Vertical gutter detection
    const vGutters = [];
    for (let x = 0; x < width; x++) {
      let gapPixels = 0;
      for (let y = 0; y < height; y++) {
        if (gray[y * width + x] > 240) gapPixels++;
      }
      if (gapPixels / height > 0.8) {
        vGutters.push(x);
      }
    }
    
    return { horizontal: hGutters, vertical: vGutters };
  }

  /**
   * Find panel boundaries from gutter positions
   */
  _findBoundariesFromGutters(gutters, maxDim, orientation) {
    const boundaries = [0];
    let currentGap = null;
    
    for (const pos of gutters) {
      if (!currentGap) {
        currentGap = { start: pos, end: pos };
      } else if (pos === currentGap.end + 1) {
        currentGap.end = pos;
      } else {
        // End of gap region
        if (currentGap.end - currentGap.start >= this.config.GAP_THRESHOLD) {
          const boundary = Math.floor((currentGap.start + currentGap.end) / 2);
          boundaries.push(boundary);
        }
        currentGap = { start: pos, end: pos };
      }
    }
    
    if (currentGap && currentGap.end - currentGap.start >= this.config.GAP_THRESHOLD) {
      boundaries.push(Math.floor((currentGap.start + currentGap.end) / 2));
    }
    
    boundaries.push(maxDim);
    return boundaries;
  }

  /**
   * Detect borderless panels using content clustering
   */
  async _detectBorderlessPanels(imageData, existingPanels) {
    const { width, height, data } = imageData;
    const gray = this._toGrayscale(data);
    
    // Create mask of existing panel regions
    const mask = new Uint8Array(width * height);
    for (const panel of existingPanels) {
      for (let y = panel.y; y < panel.y + panel.height; y++) {
        for (let x = panel.x; x < panel.x + panel.width; x++) {
          if (y >= 0 && y < height && x >= 0 && x < width) {
            mask[y * width + x] = 1;
          }
        }
      }
    }
    
    // Find connected components outside existing panels
    const components = this._findConnectedComponents(gray, mask, width, height);
    
    const borderlessPanels = [];
    for (const comp of components) {
      if (comp.area > (width * height * this.config.MIN_PANEL_AREA_RATIO)) {
        const bounds = this._computeComponentBounds(comp.pixels, width);
        borderlessPanels.push(new MangaPanel(bounds, {
          type: 'borderless',
          confidence: 0.7,
          inkDensity: comp.density
        }));
      }
    }
    
    return borderlessPanels;
  }

  /**
   * Detect inset panels (panels within other panels)
   */
  _detectInsetPanels(imageData, panels) {
    const insetPanels = [];
    
    for (const parent of panels) {
      // Look for gaps within the panel that suggest nested structure
      const region = this._extractRegion(imageData, parent.bounds);
      const internalGutters = this._detectGutters(region);
      
      // If significant internal structure found, create inset panels
      if (internalGutters.horizontal.length > 2 || internalGutters.vertical.length > 2) {
        const hBounds = this._findBoundariesFromGutters(
          internalGutters.horizontal.map(y => y + parent.y),
          parent.y + parent.height,
          'horizontal'
        );
        const vBounds = this._findBoundariesFromGutters(
          internalGutters.vertical.map(x => x + parent.x),
          parent.x + parent.width,
          'vertical'
        );
        
        const children = this._createPanelsFromBoundaries(hBounds, vBounds);
        for (const child of children) {
          if (child.area < parent.area * 0.9 && child.area > parent.area * 0.05) {
            insetPanels.push(new MangaPanel(child.bounds, {
              type: 'inset',
              confidence: 0.8,
              parentId: parent.id
            }));
          }
        }
      }
    }
    
    return insetPanels;
  }

  /**
   * Detect strong lines using Hough transform or projection
   */
  _detectStrongLines(imageData, orientation) {
    const { width, height, data } = imageData;
    const gray = this._toGrayscale(data);
    const edges = this._detectEdges(gray, width, height);
    
    const lines = [];
    const threshold = orientation === 'horizontal' ? width * 0.3 : height * 0.3;
    
    if (orientation === 'horizontal') {
      // Project onto Y axis
      for (let y = 0; y < height; y++) {
        let edgeCount = 0;
        for (let x = 0; x < width; x++) {
          if (edges[y * width + x]) edgeCount++;
        }
        if (edgeCount > threshold) {
          lines.push(y);
        }
      }
    } else {
      // Project onto X axis
      for (let x = 0; x < width; x++) {
        let edgeCount = 0;
        for (let y = 0; y < height; y++) {
          if (edges[y * width + x]) edgeCount++;
        }
        if (edgeCount > threshold) {
          lines.push(x);
        }
      }
    }
    
    return lines;
  }

  /**
   * Merge nearby lines
   */
  _mergeLines(lines, threshold) {
    if (lines.length === 0) return lines;
    
    const merged = [];
    let current = lines[0];
    let count = 1;
    
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] - current / count <= threshold) {
        current += lines[i];
        count++;
      } else {
        merged.push(Math.round(current / count));
        current = lines[i];
        count = 1;
      }
    }
    
    merged.push(Math.round(current / count));
    return merged;
  }

  /**
   * Create panels from boundary arrays
   */
  _createPanelsFromBoundaries(hBoundaries, vBoundaries) {
    const panels = [];
    
    for (let i = 0; i < hBoundaries.length - 1; i++) {
      for (let j = 0; j < vBoundaries.length - 1; j++) {
        const top = hBoundaries[i];
        const bottom = hBoundaries[i + 1];
        const left = vBoundaries[j];
        const right = vBoundaries[j + 1];
        
        panels.push(new MangaPanel({
          x: left,
          y: top,
          width: right - left,
          height: bottom - top
        }));
      }
    }
    
    return panels;
  }

  /**
   * Filter panels by size and validity
   */
  _filterPanels(panels, totalArea) {
    return panels.filter(panel => {
      const areaRatio = panel.area / totalArea;
      const aspectRatio = panel.width / panel.height;
      
      return areaRatio >= this.config.MIN_PANEL_AREA_RATIO &&
             areaRatio <= this.config.MAX_PANEL_AREA_RATIO &&
             aspectRatio >= this.config.ASPECT_RATIO_MIN &&
             aspectRatio <= this.config.ASPECT_RATIO_MAX &&
             panel.width > this.config.MIN_LINE_LENGTH &&
             panel.height > this.config.MIN_LINE_LENGTH;
    });
  }

  /**
   * Merge overlapping panels, keeping higher confidence ones
   */
  _mergeOverlappingPanels(panels) {
    panels.sort((a, b) => b.confidence - a.confidence);
    
    const merged = [];
    for (const panel of panels) {
      let shouldMerge = false;
      for (const existing of merged) {
        if (panel.overlaps(existing, 0.3)) {
          shouldMerge = true;
          break;
        }
      }
      if (!shouldMerge) {
        merged.push(panel);
      }
    }
    
    return merged;
  }

  /**
   * Detect panel types (standard, full-bleed, etc.)
   */
  _detectPanelTypes(panels, imageData) {
    const { width, height, data } = imageData;
    const gray = this._toGrayscale(data);
    
    for (const panel of panels) {
      // Check if panel touches page edges (full-bleed)
      const touchesLeft = panel.x < 10;
      const touchesRight = panel.x + panel.width > width - 10;
      const touchesTop = panel.y < 10;
      const touchesBottom = panel.y + panel.height > height - 10;
      
      if ((touchesLeft && touchesRight) || (touchesTop && touchesBottom)) {
        panel.type = 'full-bleed';
      } else if (touchesLeft || touchesRight || touchesTop || touchesBottom) {
        panel.type = 'edge-panel';
      }
      
      // Calculate ink density
      let inkPixels = 0;
      let totalPixels = 0;
      
      for (let y = panel.y; y < panel.y + panel.height; y++) {
        for (let x = panel.x; x < panel.x + panel.width; x++) {
          if (y >= 0 && y < height && x >= 0 && x < width) {
            if (gray[y * width + x] < 128) inkPixels++;
            totalPixels++;
          }
        }
      }
      
      panel.inkDensity = totalPixels > 0 ? inkPixels / totalPixels : 0;
    }
    
    return panels;
  }

  /**
   * Determine reading order based on layout and direction
   */
  _determineReadingOrder(panels) {
    if (panels.length === 0) return panels;
    
    const direction = this.config.READING_DIRECTION;
    const algorithm = this.config.READING_ORDER_ALGORITHM;
    
    // Sort based on reading direction
    if (direction === 'rtl') {
      // Traditional manga: right-to-left, top-to-bottom
      if (algorithm === 'z-pattern') {
        panels.sort((a, b) => {
          const rowDiff = Math.abs(a.center.y - b.center.y);
          if (rowDiff < Math.min(a.height, b.height) * 0.5) {
            // Same row: right to left
            return b.center.x - a.center.x;
          }
          // Different rows: top to bottom
          return a.center.y - b.center.y;
        });
      }
    } else if (direction === 'ttb') {
      // Webtoon: top to bottom
      panels.sort((a, b) => a.y - b.y);
    } else {
      // Western comics: left-to-right, top-to-bottom
      panels.sort((a, b) => {
        const rowDiff = Math.abs(a.center.y - b.center.y);
        if (rowDiff < Math.min(a.height, b.height) * 0.5) {
          return a.center.x - b.center.x;
        }
        return a.center.y - b.center.y;
      });
    }
    
    // Assign reading order
    panels.forEach((panel, index) => {
      panel.readingOrder = index;
      
      // Find neighbors
      panels.forEach(other => {
        if (other === panel) return;
        
        const dx = other.center.x - panel.center.x;
        const dy = other.center.y - panel.center.y;
        
        if (Math.abs(dy) < Math.abs(dx) && Math.abs(dy) < panel.height * 0.5) {
          if (dx > 0) panel.neighbors.right = other.id;
          else panel.neighbors.left = other.id;
        } else if (Math.abs(dx) < Math.abs(dy) && Math.abs(dx) < panel.width * 0.5) {
          if (dy > 0) panel.neighbors.bottom = other.id;
          else panel.neighbors.top = other.id;
        }
      });
    });
    
    return panels;
  }

  /**
   * Detect actual content bounds within panel (excluding white margins)
   */
  _detectContentBounds(panels, imageData) {
    const { width, height, data } = imageData;
    const gray = this._toGrayscale(data);
    
    for (const panel of panels) {
      let minX = panel.x + panel.width;
      let maxX = panel.x;
      let minY = panel.y + panel.height;
      let maxY = panel.y;
      
      let hasContent = false;
      
      for (let y = panel.y; y < panel.y + panel.height; y++) {
        for (let x = panel.x; x < panel.x + panel.width; x++) {
          if (y >= 0 && y < height && x >= 0 && x < width) {
            if (gray[y * width + x] < 240) { // Non-white pixel
              minX = Math.min(minX, x);
              maxX = Math.max(maxX, x);
              minY = Math.min(minY, y);
              maxY = Math.max(maxY, y);
              hasContent = true;
            }
          }
        }
      }
      
      if (hasContent) {
        panel.contentBounds = {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY
        };
      } else {
        panel.contentBounds = panel.bounds;
      }
    }
    
    return panels;
  }

  /**
   * Find connected components in image
   */
  _findConnectedComponents(gray, mask, width, height) {
    const visited = new Uint8Array(width * height);
    const components = [];
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (mask[idx] || visited[idx] || gray[idx] > 240) continue;
        
        // BFS to find component
        const component = [];
        const queue = [[x, y]];
        visited[idx] = 1;
        let inkSum = 0;
        
        while (queue.length > 0) {
          const [cx, cy] = queue.shift();
          const cidx = cy * width + cx;
          component.push([cx, cy]);
          inkSum += 255 - gray[cidx];
          
          // Check 4-connected neighbors
          const neighbors = [[cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]];
          for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nidx = ny * width + nx;
              if (!mask[nidx] && !visited[nidx] && gray[nidx] <= 240) {
                visited[nidx] = 1;
                queue.push([nx, ny]);
              }
            }
          }
        }
        
        if (component.length > 100) { // Filter noise
          components.push({
            pixels: component,
            area: component.length,
            density: inkSum / (component.length * 255)
          });
        }
      }
    }
    
    return components;
  }

  /**
   * Compute bounding box from component pixels
   */
  _computeComponentBounds(pixels, width) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    for (const [x, y] of pixels) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /**
   * Extract sub-region from image data
   */
  _extractRegion(imageData, bounds) {
    const { width, height, data } = imageData;
    const regionWidth = bounds.width;
    const regionHeight = bounds.height;
    const regionData = new Uint8ClampedArray(regionWidth * regionHeight * 4);
    
    for (let y = 0; y < regionHeight; y++) {
      for (let x = 0; x < regionWidth; x++) {
        const srcX = bounds.x + x;
        const srcY = bounds.y + y;
        const srcIdx = (srcY * width + srcX) * 4;
        const dstIdx = (y * regionWidth + x) * 4;
        
        if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
          regionData[dstIdx] = data[srcIdx];
          regionData[dstIdx + 1] = data[srcIdx + 1];
          regionData[dstIdx + 2] = data[srcIdx + 2];
          regionData[dstIdx + 3] = data[srcIdx + 3];
        }
      }
    }
    
    return {
      width: regionWidth,
      height: regionHeight,
      data: regionData
    };
  }

  /**
   * Edge detection using simple gradient
   */
  _detectEdges(gray, width, height) {
    const edges = new Uint8Array(width * height);
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const gx = Math.abs(gray[idx + 1] - gray[idx - 1]);
        const gy = Math.abs(gray[idx + width] - gray[idx - width]);
        edges[idx] = (gx + gy) > 30 ? 1 : 0;
      }
    }
    
    return edges;
  }

  /**
   * Convert to grayscale
   */
  _toGrayscale(data) {
    const gray = new Uint8Array(data.length / 4);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return gray;
  }

  /**
   * Scale panel coordinates
   */
  _scalePanel(panel, factor) {
    return new MangaPanel({
      x: panel.x * factor,
      y: panel.y * factor,
      width: panel.width * factor,
      height: panel.height * factor
    }, {
      ...panel,
      contentBounds: panel.contentBounds ? {
        x: panel.contentBounds.x * factor,
        y: panel.contentBounds.y * factor,
        width: panel.contentBounds.width * factor,
        height: panel.contentBounds.height * factor
      } : null
    });
  }

  /**
   * Calculate grid regularity score
   */
  _calculateGridScore(hLines, vLines) {
    if (hLines.length < 2 || vLines.length < 2) return 0;
    
    // Check spacing regularity
    const hSpacing = [];
    for (let i = 1; i < hLines.length; i++) {
      hSpacing.push(hLines[i] - hLines[i-1]);
    }
    
    const vSpacing = [];
    for (let i = 1; i < vLines.length; i++) {
      vSpacing.push(vLines[i] - vLines[i-1]);
    }
    
    const hVariance = this._variance(hSpacing);
    const vVariance = this._variance(vSpacing);
    const hMean = hSpacing.reduce((a, b) => a + b, 0) / hSpacing.length;
    const vMean = vSpacing.reduce((a, b) => a + b, 0) / vSpacing.length;
    
    const hRegularity = 1 - (hVariance / (hMean * hMean));
    const vRegularity = 1 - (vVariance / (vMean * vMean));
    
    return (hRegularity + vRegularity) / 2;
  }

  /**
   * Calculate variance
   */
  _variance(arr) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((sum, val) => sum + (val - mean) ** 2, 0) / arr.length;
  }

  /**
   * Visualize segmentation result (for debugging)
   */
  async visualize(result, originalImage) {
    const canvas = new OffscreenCanvas(
      result.pageBounds.width,
      result.pageBounds.height
    );
    const ctx = canvas.getContext('2d');
    
    // Draw original
    ctx.drawImage(originalImage, 0, 0);
    
    // Draw panel boundaries
    for (const panel of result.panels) {
      ctx.strokeStyle = panel.type === 'borderless' ? '#ff6b6b' : 
                       panel.type === 'inset' ? '#4ecdc4' : '#45b7d1';
      ctx.lineWidth = 3;
      ctx.strokeRect(panel.x, panel.y, panel.width, panel.height);
      
      // Draw reading order
      ctx.fillStyle = '#ffe66d';
      ctx.beginPath();
      ctx.arc(panel.center.x, panel.center.y, 15, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = '#000';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(panel.readingOrder), panel.center.x, panel.center.y);
      
      // Draw content bounds if different
      if (panel.contentBounds && 
          (panel.contentBounds.x !== panel.x || 
           panel.contentBounds.y !== panel.y)) {
        ctx.strokeStyle = '#95e1d3';
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(
          panel.contentBounds.x,
          panel.contentBounds.y,
          panel.contentBounds.width,
          panel.contentBounds.height
        );
        ctx.setLineDash([]);
      }
    }
    
    return await createImageBitmap(canvas);
  }

  dispose() {
    this.canvas = null;
    this.ctx = null;
    this.performance.clear();
  }
}

/**
 * Segmentation result container
 */
export class SegmentationResult {
  constructor({ panels, layoutType, pageBounds, processingTime, scaleFactor }) {
    this.panels = panels;
    this.layoutType = layoutType;
    this.pageBounds = pageBounds;
    this.processingTime = processingTime;
    this.scaleFactor = scaleFactor;
    this.timestamp = Date.now();
  }

  get panelCount() {
    return this.panels.length;
  }

  get averagePanelSize() {
    if (this.panels.length === 0) return 0;
    const totalArea = this.panels.reduce((sum, p) => sum + p.area, 0);
    return totalArea / this.panels.length;
  }

  /**
   * Get panel at specific reading order
   */
  getPanelByOrder(order) {
    return this.panels.find(p => p.readingOrder === order);
  }

  /**
   * Get panel containing point
   */
  getPanelAt(x, y) {
    return this.panels.find(p => p.contains(x, y));
  }

  /**
   * Export to JSON-serializable format
   */
  toJSON() {
    return {
      panels: this.panels.map(p => ({
        id: p.id,
        bounds: p.bounds,
        contentBounds: p.contentBounds,
        type: p.type,
        confidence: p.confidence,
        readingOrder: p.readingOrder,
        neighbors: p.neighbors,
        inkDensity: p.inkDensity
      })),
      layoutType: this.layoutType,
      pageBounds: this.pageBounds,
      processingTime: this.processingTime,
      timestamp: this.timestamp
    };
  }
}

/**
 * Quick segmentation function
 */
export async function segmentPanels(image, options = {}) {
  const segmenter = new PanelSegmenter(options.config);
  try {
    return await segmenter.segment(image, options);
  } finally {
    if (!options.keepAlive) {
      segmenter.dispose();
    }
  }
}

export default PanelSegmenter;