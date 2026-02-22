/**
 * bounding-box-utils.js
 * 
 * Advanced Bounding Box Utilities for Manga Speech Bubble Detection
 * 
 * Features:
 * - Non-Maximum Suppression (NMS) with multiple variants
 * - Soft-NMS for overlapping bubble handling
 * - Geometric operations (IoU, distance, containment)
 * - Clustering algorithms for bubble grouping
 * - Coordinate transformations
 * - Reading order optimization
 */

/**
 * Bounding box format: { x, y, width, height, [centerX], [centerY], [confidence] }
 * All coordinates in pixels, origin at top-left
 */

const EPSILON = 1e-6;

/**
 * Utility class for bounding box operations
 */
export class BoundingBoxUtils {
  constructor(options = {}) {
    this.config = {
      iouThreshold: 0.5,
      softNmsSigma: 0.5,
      clusterDistanceThreshold: 50,
      ...options
    };
  }

  // ==================== BASIC GEOMETRY ====================

  /**
   * Calculate area of bounding box
   * @param {Object} box - Bounding box
   * @returns {number}
   */
  area(box) {
    return box.width * box.height;
  }

  /**
   * Calculate center point of box (adds centerX/centerY if missing)
   * @param {Object} box 
   * @returns {Object}
   */
  addCenter(box) {
    if (box.centerX !== undefined && box.centerY !== undefined) {
      return box;
    }
    return {
      ...box,
      centerX: box.x + box.width / 2,
      centerY: box.y + box.height / 2
    };
  }

  /**
   * Calculate Intersection over Union (IoU)
   * @param {Object} boxA 
   * @param {Object} boxB 
   * @returns {number} - IoU value [0, 1]
   */
  iou(boxA, boxB) {
    const intersection = this.intersection(boxA, boxB);
    if (intersection === 0) return 0;

    const union = this.area(boxA) + this.area(boxB) - intersection;
    return intersection / (union + EPSILON);
  }

  /**
   * Calculate Intersection over Minimum Area (IoM/IoMin)
   * Useful when one box is significantly smaller
   * @param {Object} boxA 
   * @param {Object} boxB 
   * @returns {number}
   */
  iom(boxA, boxB) {
    const intersection = this.intersection(boxA, boxB);
    const minArea = Math.min(this.area(boxA), this.area(boxB));
    return intersection / (minArea + EPSILON);
  }

  /**
   * Calculate Generalized IoU (GIoU)
   * Handles non-overlapping boxes better than standard IoU
   * @param {Object} boxA 
   * @param {Object} boxB 
   * @returns {number} - GIoU [-1, 1]
   */
  giou(boxA, boxB) {
    const intersection = this.intersection(boxA, boxB);
    const union = this.area(boxA) + this.area(boxB) - intersection;
    
    // Enclosing box (smallest box containing both)
    const enclosingBox = this.enclosingBox(boxA, boxB);
    const enclosingArea = this.area(enclosingBox);
    
    const iou = intersection / (union + EPSILON);
    const giou = iou - (enclosingArea - union) / (enclosingArea + EPSILON);
    
    return giou;
  }

  /**
   * Calculate Distance IoU (DIoU)
   * Considers center point distance
   * @param {Object} boxA 
   * @param {Object} boxB 
   * @returns {number}
   */
  diou(boxA, boxB) {
    const boxAC = this.addCenter(boxA);
    const boxBC = this.addCenter(boxB);
    
    const intersection = this.intersection(boxA, boxB);
    const union = this.area(boxA) + this.area(boxB) - intersection;
    const iou = intersection / (union + EPSILON);
    
    // Center distance squared
    const centerDistSq = Math.pow(boxAC.centerX - boxBC.centerX, 2) + 
                         Math.pow(boxAC.centerY - boxBC.centerY, 2);
    
    // Diagonal of enclosing box squared
    const enclosingBox = this.enclosingBox(boxA, boxB);
    const diagonalSq = Math.pow(enclosingBox.width, 2) + Math.pow(enclosingBox.height, 2);
    
    return iou - centerDistSq / (diagonalSq + EPSILON);
  }

  /**
   * Calculate Complete IoU (CIoU)
   * Considers overlap, distance, and aspect ratio
   * @param {Object} boxA 
   * @param {Object} boxB 
   * @returns {number}
   */
  ciou(boxA, boxB) {
    const boxAC = this.addCenter(boxA);
    const boxBC = this.addCenter(boxB);
    
    const intersection = this.intersection(boxA, boxB);
    const union = this.area(boxA) + this.area(boxB) - intersection;
    const iou = intersection / (union + EPSILON);
    
    // Center distance
    const centerDistSq = Math.pow(boxAC.centerX - boxBC.centerX, 2) + 
                         Math.pow(boxAC.centerY - boxBC.centerY, 2);
    
    const enclosingBox = this.enclosingBox(boxA, boxB);
    const diagonalSq = Math.pow(enclosingBox.width, 2) + Math.pow(enclosingBox.height, 2);
    
    // Aspect ratio consistency
    const v = (4 / Math.PI ** 2) * Math.pow(
      Math.atan(boxB.width / boxB.height) - Math.atan(boxA.width / boxA.height),
      2
    );
    
    const alpha = v / ((1 - iou) + v + EPSILON);
    
    return iou - centerDistSq / (diagonalSq + EPSILON) - alpha * v;
  }

  /**
   * Calculate intersection area
   * @param {Object} boxA 
   * @param {Object} boxB 
   * @returns {number}
   */
  intersection(boxA, boxB) {
    const xLeft = Math.max(boxA.x, boxB.x);
    const yTop = Math.max(boxA.y, boxB.y);
    const xRight = Math.min(boxA.x + boxA.width, boxB.x + boxB.width);
    const yBottom = Math.min(boxA.y + boxA.height, boxB.y + boxB.height);

    if (xRight < xLeft || yBottom < yTop) {
      return 0;
    }

    return (xRight - xLeft) * (yBottom - yTop);
  }

  /**
   * Check if boxA contains boxB
   * @param {Object} container 
   * @param {Object} contained 
   * @param {number} threshold - Minimum IoM to consider as containment [0, 1]
   * @returns {boolean}
   */
  contains(container, contained, threshold = 0.9) {
    return this.iom(container, contained) >= threshold;
  }

  /**
   * Calculate smallest enclosing box
   * @param {Object} boxA 
   * @param {Object} boxB 
   * @returns {Object}
   */
  enclosingBox(boxA, boxB) {
    const x = Math.min(boxA.x, boxB.x);
    const y = Math.min(boxA.y, boxB.y);
    const x2 = Math.max(boxA.x + boxA.width, boxB.x + boxB.width);
    const y2 = Math.max(boxA.y + boxA.height, boxB.y + boxB.height);
    
    return {
      x,
      y,
      width: x2 - x,
      height: y2 - y
    };
  }

  /**
   * Calculate Euclidean distance between box centers
   * @param {Object} boxA 
   * @param {Object} boxB 
   * @returns {number}
   */
  centerDistance(boxA, boxB) {
    const a = this.addCenter(boxA);
    const b = this.addCenter(boxB);
    return Math.sqrt(
      Math.pow(a.centerX - b.centerX, 2) + 
      Math.pow(a.centerY - b.centerY, 2)
    );
  }

  /**
   * Calculate Manhattan distance between centers
   * @param {Object} boxA 
   * @param {Object} boxB 
   * @returns {number}
   */
  manhattanDistance(boxA, boxB) {
    const a = this.addCenter(boxA);
    const b = this.addCenter(boxB);
    return Math.abs(a.centerX - b.centerX) + Math.abs(a.centerY - b.centerY);
  }

  // ==================== NMS VARIANTS ====================

  /**
   * Standard Non-Maximum Suppression
   * Removes overlapping boxes with lower confidence
   * 
   * @param {Array} boxes - Array of boxes with confidence scores
   * @param {number} threshold - IoU threshold for suppression
   * @returns {Array} - Filtered boxes
   */
  nms(boxes, threshold = this.config.iouThreshold) {
    if (boxes.length === 0) return [];
    
    // Sort by confidence descending
    const sorted = [...boxes].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    const suppressed = new Array(sorted.length).fill(false);
    const result = [];
    
    for (let i = 0; i < sorted.length; i++) {
      if (suppressed[i]) continue;
      
      result.push(sorted[i]);
      
      for (let j = i + 1; j < sorted.length; j++) {
        if (suppressed[j]) continue;
        
        const iou = this.iou(sorted[i], sorted[j]);
        if (iou > threshold) {
          suppressed[j] = true;
        }
      }
    }
    
    return result;
  }

  /**
   * Soft-NMS: Decays scores instead of hard suppression
   * Better for manga where bubbles may genuinely overlap
   * 
   * @param {Array} boxes 
   * @param {number} sigma - Gaussian sigma for score decay
   * @param {number} threshold - Minimum score to keep
   * @param {string} method - 'linear' or 'gaussian'
   * @returns {Array}
   */
  softNms(
    boxes, 
    sigma = this.config.softNmsSigma, 
    threshold = 0.01,
    method = 'gaussian'
  ) {
    if (boxes.length === 0) return [];
    
    // Clone boxes and ensure scores exist
    const scores = boxes.map(b => b.confidence || 0);
    const remaining = boxes.map((b, i) => ({ ...b, index: i }));
    const result = [];
    
    while (remaining.length > 0) {
      // Find box with max score
      let maxIdx = 0;
      for (let i = 1; i < remaining.length; i++) {
        if (scores[remaining[i].index] > scores[remaining[maxIdx].index]) {
          maxIdx = i;
        }
      }
      
      const current = remaining[maxIdx];
      const currentScore = scores[current.index];
      
      if (currentScore < threshold) break;
      
      result.push(current);
      remaining.splice(maxIdx, 1);
      
      // Update scores of remaining boxes
      for (let i = remaining.length - 1; i >= 0; i--) {
        const box = remaining[i];
        const iou = this.iou(current, box);
        
        if (iou > 0) {
          let weight;
          if (method === 'linear') {
            weight = iou > sigma ? 1 - iou : 1;
          } else { // gaussian
            weight = Math.exp(-(iou * iou) / sigma);
          }
          
          scores[box.index] *= weight;
          
          if (scores[box.index] < threshold) {
            remaining.splice(i, 1);
          }
        }
      }
    }
    
    // Update confidence scores in result
    return result.map(box => ({
      ...box,
      confidence: scores[box.index]
    }));
  }

  /**
   * Class-aware NMS: Only suppress same-class detections
   * @param {Array} boxes - Boxes with classId property
   * @param {number} threshold 
   * @returns {Array}
   */
  classAwareNms(boxes, threshold = this.config.iouThreshold) {
    // Group by class
    const byClass = new Map();
    boxes.forEach(box => {
      const classId = box.classId || 0;
      if (!byClass.has(classId)) {
        byClass.set(classId, []);
      }
      byClass.get(classId).push(box);
    });
    
    // Run NMS per class
    const results = [];
    for (const [, classBoxes] of byClass) {
      results.push(...this.nms(classBoxes, threshold));
    }
    
    return results;
  }

  /**
   * Multi-class NMS with class-agnostic suppression
   * @param {Array} boxes 
   * @param {number} threshold 
   * @returns {Array}
   */
  multiClassNms(boxes, threshold = this.config.iouThreshold) {
    // Sort by confidence
    const sorted = [...boxes].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    const suppressed = new Array(sorted.length).fill(false);
    const result = [];
    
    for (let i = 0; i < sorted.length; i++) {
      if (suppressed[i]) continue;
      
      result.push(sorted[i]);
      
      for (let j = i + 1; j < sorted.length; j++) {
        if (suppressed[j]) continue;
        
        const iou = this.iou(sorted[i], sorted[j]);
        if (iou > threshold) {
          // If same class, always suppress
          // If different class, suppress only if IoU is very high (>0.8)
          if (sorted[i].classId === sorted[j].classId || iou > 0.8) {
            suppressed[j] = true;
          }
        }
      }
    }
    
    return result;
  }

  /**
   * DIoU-NMS: Uses distance metric for better localization
   * @param {Array} boxes 
   * @param {number} threshold 
   * @returns {Array}
   */
  diouNms(boxes, threshold = this.config.iouThreshold) {
    const sorted = [...boxes].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    const suppressed = new Array(sorted.length).fill(false);
    const result = [];
    
    for (let i = 0; i < sorted.length; i++) {
      if (suppressed[i]) continue;
      
      result.push(sorted[i]);
      
      for (let j = i + 1; j < sorted.length; j++) {
        if (suppressed[j]) continue;
        
        const diou = this.diou(sorted[i], sorted[j]);
        // DIoU can be negative, so we use a different threshold logic
        if (diou > threshold - 0.2) { // Adjusted threshold for DIoU
          suppressed[j] = true;
        }
      }
    }
    
    return result;
  }

  // ==================== BOX OPERATIONS ====================

  /**
   * Merge two overlapping boxes into one
   * @param {Object} boxA 
   * @param {Object} boxB 
   * @param {string} strategy - 'union', 'intersection', or 'weighted'
   * @returns {Object}
   */
  merge(boxA, boxB, strategy = 'union') {
    if (strategy === 'union') {
      return this.enclosingBox(boxA, boxB);
    }
    
    if (strategy === 'intersection') {
      const x = Math.max(boxA.x, boxB.x);
      const y = Math.max(boxA.y, boxB.y);
      const x2 = Math.min(boxA.x + boxA.width, boxB.x + boxB.width);
      const y2 = Math.min(boxA.y + boxA.height, boxB.y + boxB.height);
      
      return {
        x,
        y,
        width: Math.max(0, x2 - x),
        height: Math.max(0, y2 - y)
      };
    }
    
    if (strategy === 'weighted') {
      const scoreA = boxA.confidence || 1;
      const scoreB = boxB.confidence || 1;
      const total = scoreA + scoreB;
      
      return {
        x: (boxA.x * scoreA + boxB.x * scoreB) / total,
        y: (boxA.y * scoreA + boxB.y * scoreB) / total,
        width: (boxA.width * scoreA + boxB.width * scoreB) / total,
        height: (boxA.height * scoreA + boxB.height * scoreB) / total,
        confidence: Math.max(scoreA, scoreB)
      };
    }
    
    return this.enclosingBox(boxA, boxB);
  }

  /**
   * Expand box by padding
   * @param {Object} box 
   * @param {number} padding - Pixels to expand (can be negative)
   * @returns {Object}
   */
  expand(box, padding) {
    return {
      x: box.x - padding,
      y: box.y - padding,
      width: box.width + padding * 2,
      height: box.height + padding * 2
    };
  }

  /**
   * Expand box by ratio
   * @param {Object} box 
   * @param {number} ratio - E.g., 0.1 expands by 10% on each side
   * @returns {Object}
   */
  expandRatio(box, ratio) {
    const dw = box.width * ratio;
    const dh = box.height * ratio;
    
    return {
      x: box.x - dw,
      y: box.y - dh,
      width: box.width + dw * 2,
      height: box.height + dh * 2
    };
  }

  /**
   * Clip box to image boundaries
   * @param {Object} box 
   * @param {number} imgWidth 
   * @param {number} imgHeight 
   * @returns {Object}
   */
  clip(box, imgWidth, imgHeight) {
    const x = Math.max(0, Math.min(box.x, imgWidth));
    const y = Math.max(0, Math.min(box.y, imgHeight));
    const x2 = Math.max(0, Math.min(box.x + box.width, imgWidth));
    const y2 = Math.max(0, Math.min(box.y + box.height, imgHeight));
    
    return {
      x,
      y,
      width: x2 - x,
      height: y2 - y
    };
  }

  /**
   * Scale box coordinates
   * @param {Object} box 
   * @param {number} scaleX 
   * @param {number} scaleY 
   * @returns {Object}
   */
  scale(box, scaleX, scaleY = scaleX) {
    return {
      x: box.x * scaleX,
      y: box.y * scaleY,
      width: box.width * scaleX,
      height: box.height * scaleY
    };
  }

  /**
   * Translate box
   * @param {Object} box 
   * @param {number} dx 
   * @param {number} dy 
   * @returns {Object}
   */
  translate(box, dx, dy) {
    return {
      ...box,
      x: box.x + dx,
      y: box.y + dy
    };
  }

  /**
   * Calculate aspect ratio
   * @param {Object} box 
   * @returns {number}
   */
  aspectRatio(box) {
    return box.width / (box.height + EPSILON);
  }

  /**
   * Check if box is valid (positive dimensions)
   * @param {Object} box 
   * @returns {boolean}
   */
  isValid(box) {
    return box.width > 0 && box.height > 0;
  }

  // ==================== CLUSTERING ====================

  /**
   * DBSCAN clustering for bubble grouping
   * Groups nearby bubbles (useful for panel detection)
   * 
   * @param {Array} boxes 
   * @param {number} eps - Maximum distance between neighbors
   * @param {number} minPts - Minimum points to form cluster
   * @returns {Array<Array>} - Array of clusters
   */
  dbscanClustering(boxes, eps = this.config.clusterDistanceThreshold, minPts = 2) {
    const n = boxes.length;
    const visited = new Array(n).fill(false);
    const clustered = new Array(n).fill(false);
    const clusters = [];
    const noise = [];
    
    // Pre-compute distance matrix
    const distMatrix = Array(n).fill(null).map(() => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dist = this.centerDistance(boxes[i], boxes[j]);
        distMatrix[i][j] = dist;
        distMatrix[j][i] = dist;
      }
    }
    
    const regionQuery = (p) => {
      const neighbors = [];
      for (let i = 0; i < n; i++) {
        if (distMatrix[p][i] <= eps) {
          neighbors.push(i);
        }
      }
      return neighbors;
    };
    
    const expandCluster = (p, neighbors, cluster) => {
      cluster.push(p);
      clustered[p] = true;
      
      let i = 0;
      while (i < neighbors.length) {
        const q = neighbors[i];
        
        if (!visited[q]) {
          visited[q] = true;
          const qNeighbors = regionQuery(q);
          if (qNeighbors.length >= minPts) {
            neighbors.push(...qNeighbors.filter(n => !clustered[n]));
          }
        }
        
        if (!clustered[q]) {
          cluster.push(q);
          clustered[q] = true;
        }
        
        i++;
      }
    };
    
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      
      visited[i] = true;
      const neighbors = regionQuery(i);
      
      if (neighbors.length < minPts) {
        noise.push(i);
      } else {
        const cluster = [];
        expandCluster(i, neighbors, cluster);
        clusters.push(cluster.map(idx => boxes[idx]));
      }
    }
    
    return clusters;
  }

  /**
   * Agglomerative hierarchical clustering
   * @param {Array} boxes 
   * @param {number} maxDistance - Stop merging when min distance > maxDistance
   * @returns {Array<Array>}
   */
  hierarchicalClustering(boxes, maxDistance = this.config.clusterDistanceThreshold) {
    // Start with each box as its own cluster
    let clusters = boxes.map(box => [box]);
    
    while (clusters.length > 1) {
      let minDist = Infinity;
      let toMerge = [0, 1];
      
      // Find closest pair of clusters
      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const dist = this._clusterDistance(clusters[i], clusters[j]);
          if (dist < minDist) {
            minDist = dist;
            toMerge = [i, j];
          }
        }
      }
      
      if (minDist > maxDistance) break;
      
      // Merge clusters
      const merged = [...clusters[toMerge[0]], ...clusters[toMerge[1]]];
      clusters = clusters.filter((_, idx) => !toMerge.includes(idx));
      clusters.push(merged);
    }
    
    return clusters;
  }

  /**
   * Calculate distance between two clusters (single linkage)
   * @private
   */
  _clusterDistance(clusterA, clusterB) {
    let minDist = Infinity;
    for (const a of clusterA) {
      for (const b of clusterB) {
        const dist = this.centerDistance(a, b);
        if (dist < minDist) minDist = dist;
      }
    }
    return minDist;
  }

  // ==================== READING ORDER ====================

  /**
   * Calculate manga reading order (right-to-left, top-to-bottom)
   * @param {Array} boxes 
   * @param {Object} options 
   * @returns {Array} - Boxes with readingOrder property
   */
  calculateReadingOrder(boxes, options = {}) {
    const {
      tolerance = 0.3,  // Row height tolerance as ratio of box height
      direction = 'rtl' // 'rtl' (manga) or 'ltr' (comics)
    } = options;
    
    if (boxes.length === 0) return [];
    
    // Add centers if missing
    const withCenters = boxes.map(b => this.addCenter(b));
    
    // Sort by Y coordinate first
    withCenters.sort((a, b) => a.centerY - b.centerY);
    
    // Group into rows using clustering
    const rows = [];
    let currentRow = [withCenters[0]];
    let rowCenterY = withCenters[0].centerY;
    
    for (let i = 1; i < withCenters.length; i++) {
      const box = withCenters[i];
      const avgHeight = currentRow.reduce((sum, b) => sum + b.height, 0) / currentRow.length;
      
      if (Math.abs(box.centerY - rowCenterY) < avgHeight * tolerance) {
        currentRow.push(box);
        rowCenterY = currentRow.reduce((sum, b) => sum + b.centerY, 0) / currentRow.length;
      } else {
        // Sort current row by X (RTL for manga)
        currentRow.sort((a, b) => direction === 'rtl' ? 
          b.centerX - a.centerX : 
          a.centerX - b.centerX
        );
        rows.push(currentRow);
        
        currentRow = [box];
        rowCenterY = box.centerY;
      }
    }
    
    // Don't forget last row
    if (currentRow.length > 0) {
      currentRow.sort((a, b) => direction === 'rtl' ? 
        b.centerX - a.centerX : 
        a.centerX - b.centerX
      );
      rows.push(currentRow);
    }
    
    // Flatten and assign order
    let order = 1;
    const result = [];
    for (const row of rows) {
      for (const box of row) {
        result.push({ ...box, readingOrder: order++ });
      }
    }
    
    return result;
  }

  /**
   * Alternative: Column-based reading order (for vertical text)
   * @param {Array} boxes 
   * @param {Object} options 
   * @returns {Array}
   */
  calculateColumnOrder(boxes, options = {}) {
    const {
      tolerance = 0.3,
      direction = 'ttb' // 'ttb' (top-to-bottom) or 'btt' (bottom-to-top)
    } = options;
    
    if (boxes.length === 0) return [];
    
    const withCenters = boxes.map(b => this.addCenter(b));
    
    // Sort by X first
    withCenters.sort((a, b) => a.centerX - b.centerX);
    
    // Group into columns
    const columns = [];
    let currentCol = [withCenters[0]];
    let colCenterX = withCenters[0].centerX;
    
    for (let i = 1; i < withCenters.length; i++) {
      const box = withCenters[i];
      const avgWidth = currentCol.reduce((sum, b) => sum + b.width, 0) / currentCol.length;
      
      if (Math.abs(box.centerX - colCenterX) < avgWidth * tolerance) {
        currentCol.push(box);
        colCenterX = currentCol.reduce((sum, b) => sum + b.centerX, 0) / currentCol.length;
      } else {
        // Sort column by Y
        currentCol.sort((a, b) => direction === 'ttb' ? 
          a.centerY - b.centerY : 
          b.centerY - a.centerY
        );
        columns.push(currentCol);
        
        currentCol = [box];
        colCenterX = box.centerX;
      }
    }
    
    if (currentCol.length > 0) {
      currentCol.sort((a, b) => direction === 'ttb' ? 
        a.centerY - b.centerY : 
        b.centerY - a.centerY
      );
      columns.push(currentCol);
    }
    
    // Assign order (columns RTL, within column TTB)
    let order = 1;
    const result = [];
    for (let i = columns.length - 1; i >= 0; i--) { // RTL
      for (const box of columns[i]) {
        result.push({ ...box, readingOrder: order++ });
      }
    }
    
    return result;
  }

  /**
   * Smart reading order that adapts to layout
   * Detects if layout is row-based or column-based
   * @param {Array} boxes 
   * @returns {Array}
   */
  smartReadingOrder(boxes) {
    if (boxes.length < 2) return boxes.map((b, i) => ({ ...b, readingOrder: i + 1 }));
    
    const withCenters = boxes.map(b => this.addCenter(b));
    
    // Calculate variance in X and Y positions
    const xPositions = withCenters.map(b => b.centerX);
    const yPositions = withCenters.map(b => b.centerY);
    
    const variance = (arr) => {
      const mean = arr.reduce((a, b) => a + b) / arr.length;
      return arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
    };
    
    const xVariance = variance(xPositions);
    const yVariance = variance(yPositions);
    
    // If X variance is higher, likely column-based (vertical text)
    // If Y variance is higher, likely row-based (horizontal text)
    const isColumnBased = xVariance > yVariance;
    
    if (isColumnBased) {
      return this.calculateColumnOrder(boxes);
    } else {
      return this.calculateReadingOrder(boxes);
    }
  }

  // ==================== VALIDATION & DEBUG ====================

  /**
   * Validate box format
   * @param {Object} box 
   * @returns {boolean}
   */
  validate(box) {
    return (
      typeof box.x === 'number' &&
      typeof box.y === 'number' &&
      typeof box.width === 'number' &&
      typeof box.height === 'number' &&
      box.width >= 0 &&
      box.height >= 0 &&
      !isNaN(box.x + box.y + box.width + box.height)
    );
  }

  /**
   * Format box for output (rounds values)
   * @param {Object} box 
   * @param {number} precision 
   * @returns {Object}
   */
  format(box, precision = 2) {
    const round = (n) => Math.round(n * Math.pow(10, precision)) / Math.pow(10, precision);
    
    return {
      x: round(box.x),
      y: round(box.y),
      width: round(box.width),
      height: round(box.height),
      ...(box.centerX !== undefined && { centerX: round(box.centerX) }),
      ...(box.centerY !== undefined && { centerY: round(box.centerY) }),
      ...(box.confidence !== undefined && { confidence: round(box.confidence) }),
      ...(box.classId !== undefined && { classId: box.classId }),
      ...(box.readingOrder !== undefined && { readingOrder: box.readingOrder })
    };
  }

  /**
   * Calculate total coverage area of boxes (union)
   * @param {Array} boxes 
   * @returns {number}
   */
  coverageArea(boxes) {
    if (boxes.length === 0) return 0;
    
    // Use scanline algorithm for accurate union area
    const events = [];
    
    boxes.forEach(box => {
      events.push({ y: box.y, type: 'start', box });
      events.push({ y: box.y + box.height, type: 'end', box });
    });
    
    events.sort((a, b) => a.y - b.y);
    
    let area = 0;
    let prevY = events[0].y;
    const active = new Set();
    
    for (const event of events) {
      const currentY = event.y;
      
      if (currentY > prevY && active.size > 0) {
        // Calculate active width
        const intervals = [];
        for (const box of active) {
          intervals.push([box.x, box.x + box.width]);
        }
        
        // Merge intervals
        intervals.sort((a, b) => a[0] - b[0]);
        let mergedWidth = 0;
        let current = intervals[0];
        
        for (let i = 1; i < intervals.length; i++) {
          if (intervals[i][0] <= current[1]) {
            current[1] = Math.max(current[1], intervals[i][1]);
          } else {
            mergedWidth += current[1] - current[0];
            current = intervals[i];
          }
        }
        mergedWidth += current[1] - current[0];
        
        area += mergedWidth * (currentY - prevY);
      }
      
      if (event.type === 'start') {
        active.add(event.box);
      } else {
        active.delete(event.box);
      }
      
      prevY = currentY;
    }
    
    return area;
  }

  /**
   * Serialize box to string
   * @param {Object} box 
   * @returns {string}
   */
  serialize(box) {
    return `${box.x},${box.y},${box.width},${box.height}`;
  }

  /**
   * Deserialize string to box
   * @param {string} str 
   * @returns {Object}
   */
  deserialize(str) {
    const [x, y, width, height] = str.split(',').map(Number);
    return { x, y, width, height };
  }
}

/**
 * Static utility methods for quick access
 */
export const BoxUtils = {
  iou: (a, b) => new BoundingBoxUtils().iou(a, b),
  nms: (boxes, thresh) => new BoundingBoxUtils().nms(boxes, thresh),
  merge: (a, b) => new BoundingBoxUtils().merge(a, b),
  calculateReadingOrder: (boxes) => new BoundingBoxUtils().calculateReadingOrder(boxes)
};

export default BoundingBoxUtils;