/* =============================================================================
 * ABS Viewer - js/app.js
 * -----------------------------------------------------------------------------
 * Single-file Vue 3 application for the ABS Viewer.
 *
 * Modules (all inside this file):
 *   1. Utilities
 *   2. ABS Parser (text -> JSON records)
 *   3. Geometry Builder (shape points + bounds)
 *   4. Thumbnail Renderer (lazy, visible-only canvas previews)
 *   5. 2D Viewer (zoom / pan / fit / dimension / scale)
 *   6. 3D Viewer (Three.js, custom orbit controls, grid / axis / tube)
 *   7. Vue Application (Options API)
 *
 * Architecture notes:
 *   - absview.py kept untouched (HTML/CSS/JS were extended on request).
 *   - All rendering is direct Canvas / Three.js (no bitmap images, no SVG)
 *   - PyWebView bridge is guarded (works in browser fallback too)
 *   - Thumbnails render only when visible; parsed geometry + thumbnails cached
 *   - Per-file aggregates (records / weight / bars) are cached on each file
 *     object at parse time to avoid repeated O(n) filtering on every render.
 * ========================================================================== */

/** Display offset for overlapping stirrup hooks (in mm). */
const DISPLAY_STIRRUP_OVERLAP_OFFSET = 30;

'use strict';

/* =============================================================================
 * 1. Utilities
 * ========================================================================== */

/** Clamp a value between min and max. */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/** Format a world-space length for display (mm or m). */
function fmtLength(value) {
    if (!isFinite(value) || value === 0) return '0';
    if (Math.abs(value) >= 1000) return (value / 1000).toFixed(2) + ' m'; // Show in meters if >= 1m
    return Math.round(value / 10) + ' cm'; // Show in cm if < 1m
}

/** Compute a bounding box from an array of [x, y, z] points. */
function computeBounds(points) {
    if (!points || points.length === 0) {
        return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
    }
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const p of points) {
        const x = p[0] || 0, y = p[1] || 0, z = p[2] || 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    return { minX, maxX, minY, maxY, minZ, maxZ };
}

/** Pick a "nice" grid step so lines are roughly `target` pixels apart. */
function niceStep(target) {
    if (target <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const mag = target / pow;
    let step;
    if (mag < 1.5) step = 1;
    else if (mag < 3.5) step = 2;
    else if (mag < 7.5) step = 5;
    else step = 10;
    return step * pow;
}

/** Show a transient toast notification (uses existing .toast CSS). */
function notify(message, type = 'info') {
    const colors = { info: 'var(--primary)', success: 'var(--success)', error: 'var(--danger)' };
    const div = document.createElement('div');
    div.className = 'toast';
    div.style.borderLeftColor = colors[type] || colors.info;
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.transition = 'opacity .3s';
        div.style.opacity = '0';
        setTimeout(() => div.remove(), 320);
    }, 2600);
}

/** Return the PyWebView API object if available, otherwise null. */
function getApi() {
    if (window.pywebview && window.pywebview.api) {
        return window.pywebview.api;
    }
    return null;
}

/* =============================================================================
 * 2. ABS Parser (BVBS 3.1)
 * -----------------------------------------------------------------------------
 * Converts BVBS ABS text (".abs") into structured JSON records.
 *
 * Each sentence:  BFxx@  <H block> <G/A/M/X/Y/E/P blocks>  C<sum>@  CR/LF
 *   - Block identifiers are single uppercase letters (H, G, A, M, X, Y, E,
 *     P, C); geometry blocks can be compound "Gx" / "Gy" for bent meshes.
 *   - Fields are lowercase letters (a..z) terminated by "@".
 *   - Obergruppen: BF2D, BF3D, BFWE, BFMA, BFGT, BFAU.
 *
 * Supported geometry:
 *   BF2D - straight legs (l) and circular bends (r + opening angle w)
 *   BF3D - x / y / z coordinate triples (axis dimensions)
 *   BFWE - planar polygon (l / r / w) + helix turns (n) and pitch (g)
 *   BFMA - rectangular mesh l x b (optionally bent via Gx / Gy)
 *   BFGT - lattice girder l x h
 *   BFAU - spacers / support cages (straight l)
 *
 * Checksum:  IP = 96 - (ASCII sum up to and including "C" mod 32)
 * ========================================================================== */

const ABSParser = {

    // A data record (sentence) always starts with one of these markers.
    RECORD_RE: /^BF(2D|3D|WE|MA|GT|AU)@/,

    /**
     * Parse BVBS ABS text into records.
     *
     * Each sentence is a sequence of blocks (H, G, A, M, X/Y/E, P, C) on one
     * physical line, terminated by a checksum block and CR/LF. To tolerate
     * editors that wrap long lines, lines are accumulated until a checksum
     * terminator "C<digits>@" is found, then split into individual records.
     */
    parse(text, fileName, fileIndex) {
        const lines = String(text || '').split(/\r?\n/);
        const records = [];
        let pending = '';
        let projectName = '';

        const flush = () => {
            if (!pending) return;
            // One physical line may hold several records; split on markers.
            const chunks = pending.split(/(?=BF(?:2D|3D|WE|MA|GT|AU)@)/);
            for (const chunk of chunks) {
                if (!this.RECORD_RE.test(chunk)) continue; // preamble / junk
                const rec = this.parseRecord(chunk, fileName, fileIndex, records.length);
                if (rec) {
                    records.push(rec);
                    if (!projectName) projectName = rec.projectName || fileName;
                }
            }
            pending = '';
        };

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            pending += line;
            // A complete sentence ends with a checksum block.
            if (/C\d+@$/.test(pending)) flush();
        }
        // Flush a trailing sentence that may lack a checksum (still parseable).
        flush();

        return {
            fileName,
            projectName: projectName || fileName,
            records
        };
    },

    /**
     * Parse a single "BFxx@...@C<sum>@" sentence into a record object.
     */
    parseRecord(text, fileName, fileIndex, index) {
        const m = text.match(/^BF(2D|3D|WE|MA|GT|AU)@/);
        if (!m) return null;
        const group = m[1];
        const body = text.slice(m[0].length);

        // Header (H), geometry (G), spacer (A), bar-mat (X/Y/E), private (P),
        // muffler/coupler (M),
        // checksum (C) blocks grouped by identifier.
        const blocks = this.parseBlocks(body);
        const H = blocks.H || [];
        const G = blocks.G || [];

        const field = (arr, id) => {
            for (const f of arr) if (f.id === id) return f.value;
            return null;
        };

        const position = field(H, 'p') || String(index + 1);
        const headerLength = parseFloat(field(H, 'l')) || 0;
        const quantity = parseInt(field(H, 'n'), 10) || 1;
        const weight = parseFloat(field(H, 'e')) || 0;
        const diameter = parseFloat(field(H, 'd')) || 0;
        const grade = field(H, 'g') || '';
        const matType = field(H, 'm') || '';
        const width = parseFloat(field(H, 'b')) || 0;
        const height = parseFloat(field(H, 'h')) || 0;

        // Parse Coupler/Muffler block (M)
        const M = blocks.M || [];
        const startCouplerManufacturer = field(M, 'a');
        const startCouplerType = field(M, 'b');
        const endCouplerManufacturer = field(M, 'n');
        const endCouplerType = field(M, 'o');

        let startCoupler = null;
        if (startCouplerManufacturer && startCouplerType) {
            startCoupler = { manufacturer: startCouplerManufacturer, type: startCouplerType };
        }

        let endCoupler = null;
        if (endCouplerManufacturer && endCouplerType) {
            endCoupler = { manufacturer: endCouplerManufacturer, type: endCouplerType };
        }

        const originalGeometry = this.buildGeometry(group, G, blocks, headerLength, width, height);
        const displayGeometry = this.createDisplayGeometry(originalGeometry);
        const originalPts = (originalGeometry.points && originalGeometry.points.length) ? originalGeometry.points : [[0, 0, 0], [headerLength || 1, 0, 0]];
        const bounds = computeBounds(originalPts);

        const rec = {
            id: 'f' + fileIndex + '_r' + index,
            type: 'BF' + group,          // BF2D / BF3D / BFWE / BFMA / BFGT / BFAU
            position: String(position),
            diameter,
            quantity,
            length: headerLength,        // mm (from header 'l' field, as requested)
            headerLength,
            weight,                      // kg per bar (header e)
            weightTotal: weight * quantity,
            grade,
            matType,
            width,
            height,
            geometry: originalGeometry,
            startCoupler,
            endCoupler,
            preview: displayGeometry, // Use display geometry for previews and viewers
            bounds,
            file: fileName,
            fileIndex,
            fileName,
            projectName: field(H, 'j') || field(H, 'r') || fileName
        };
        rec.checksumOK = this.verifyChecksum(text);
        return rec;
    },

    /**
     * Creates a display-only geometry by offsetting overlapping hook segments.
     * This is for visualization only and does not change the true geometry.
     * @param {object} originalGeometry The original geometry object { points, is3D, length, angles }
     * @returns {object} A new geometry object for display.
     */
    createDisplayGeometry(originalGeometry) {
        const points = originalGeometry.points;
        if (!points || points.length < 3) {
            return originalGeometry; // Not a closed shape or too short
        }

        // A simple heuristic for stirrups: closed or nearly-closed shapes.
        const start = points[0];
        const end = points[points.length - 1];
        const isClosedShape = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]) < (originalGeometry.length * 0.05);

        if (!isClosedShape) {
            return originalGeometry;
        }

        const newPoints = points.map(p => [...p]); // Create a mutable copy
        const offset = DISPLAY_STIRRUP_OVERLAP_OFFSET;
        const epsilon = 1e-3;

        // Detect overlapping hook at the end of the polyline
        // Example: Pn-2 -> Pn-1 -> Pn (end hook) overlaps P0 -> P1 -> P2 (start)
        if (points.length >= 4) {
            const p0 = points[0], p1 = points[1];
            const pn_1 = points[points.length - 1], pn_2 = points[points.length - 2];

            // Check if last segment (Pn-2 -> Pn-1) is collinear and overlapping with first segment (P0 -> P1)
            const v_start = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
            const v_end = [pn_1[0] - pn_2[0], pn_1[1] - pn_2[1], pn_1[2] - pn_2[2]];

            const len_start = Math.hypot(...v_start);
            const len_end = Math.hypot(...v_end);

            if (len_start > epsilon && len_end > epsilon) {
                const dir_start = v_start.map(c => c / len_start);
                const dir_end = v_end.map(c => c / len_end);

                // Check for collinearity (dot product is ~1 or ~-1)
                const dot = dir_start.reduce((sum, val, i) => sum + val * dir_end[i], 0);

                if (Math.abs(Math.abs(dot) - 1) < epsilon) {
                    // Segments are parallel. Check for overlap.
                    // A simple check is if Pn-1 is on the line segment P0-P1.
                    const dist_start = Math.hypot(pn_1[0] - p0[0], pn_1[1] - p0[1], pn_1[2] - p0[2]);
                    const dist_end = Math.hypot(pn_1[0] - p1[0], pn_1[1] - p1[1], pn_1[2] - p1[2]);

                    if (Math.abs(dist_start + dist_end - len_start) < epsilon) {
                        // Pn-1 lies on the segment P0-P1. We have an overlap.
                        // Calculate a perpendicular offset vector.
                        // For 2D shapes, this is simple. For 3D, we need a consistent plane.
                        let offsetVec;
                        if (originalGeometry.is3D) {
                            // For 3D, find a vector perpendicular to the segment and the "up" direction (e.g., Z-axis)
                            // to keep the offset planar.
                            const up = [0, 0, 1];
                            offsetVec = [
                                dir_start[1] * up[2] - dir_start[2] * up[1],
                                dir_start[2] * up[0] - dir_start[0] * up[2],
                                dir_start[0] * up[1] - dir_start[1] * up[0]
                            ];
                        } else {
                            // For 2D, just rotate the direction vector by 90 degrees.
                            offsetVec = [-dir_start[1], dir_start[0], 0];
                        }

                        const offsetLen = Math.hypot(...offsetVec);
                        if (offsetLen > epsilon) {
                            const normalizedOffset = offsetVec.map(c => c / offsetLen * offset);

                            // Apply offset to the hook segments
                            // We offset the last two points (the hook)
                            newPoints[newPoints.length - 1] = [pn_1[0] + normalizedOffset[0], pn_1[1] + normalizedOffset[1], pn_1[2] + normalizedOffset[2]];
                            newPoints[newPoints.length - 2] = [pn_2[0] + normalizedOffset[0], pn_2[1] + normalizedOffset[1], pn_2[2] + normalizedOffset[2]];

                            // Also offset the point before the hook to blend the transition
                            if (newPoints.length > 2) {
                                const pn_3 = points[points.length - 3];
                                newPoints[newPoints.length - 3] = [pn_3[0] + normalizedOffset[0] * 0.5, pn_3[1] + normalizedOffset[1] * 0.5, pn_3[2] + normalizedOffset[2] * 0.5];
                            }
                        }
                    }
                }
            }
        }

        // Return a new geometry object for display
        return { ...originalGeometry, points: newPoints };
    },

    /**
     * Scan the record body after "BFxx@" and group lowercase fields by block.
     * Block ids: H, G, A, M, X, Y, E, P, C (plus compound Gx/Gy for bent mats).
     */
    parseBlocks(body) {
        const blocks = {};
        let current = null;
        const len = body.length;
        let i = 0;

        while (i < len) {
            const ch = body[i];

            if (ch >= 'A' && ch <= 'Z') {
                let id = ch;
                const nx = body[i + 1];
                // Compound geometry blocks for bent mats: Gx / Gy.
                // Ambiguity: "Gx294@..." or "Gx-270@..." (BF3D) means plain
                // G block with an x field (digit or minus follows), while
                // "Gyl200@..." (bent BFMA) means compound Gx/Gy block (a
                // lowercase field letter like 'l' follows).
                if (ch === 'G' && (nx === 'x' || nx === 'y') && body[i + 2] >= 'a' && body[i + 2] <= 'z') {
                    id = ch + nx;
                    i++;
                }
                // Some exports use a capital 'I' for the length field.
                else if (ch === 'I' && nx >= '0' && nx <= '9') {
                    let v = '';
                    i++;
                    while (i < len && body[i] !== '@') { v += body[i]; i++; }
                    if (body[i] === '@') i++;
                    if (current) current.push({ id: 'l', value: v });
                    continue;
                }
                // Raw-value blocks: C (checksum) and P (private data).
                if (id === 'C' || id === 'P') {
                    let raw = '';
                    i++;
                    while (i < len && body[i] !== '@') { raw += body[i]; i++; }
                    if (body[i] === '@') i++;
                    if (!blocks[id]) blocks[id] = [];
                    blocks[id].push({ id: 'value', value: raw });
                } else {
                    if (!blocks[id]) blocks[id] = [];
                    current = blocks[id];
                }
                i++;
            } else if (ch >= 'a' && ch <= 'z') {
                if (!current) { i++; continue; }
                const fid = ch;
                i++;
                let v = '';
                while (i < len && body[i] !== '@') { v += body[i]; i++; }
                if (body[i] === '@') i++;
                current.push({ id: fid, value: v });
            } else {
                i++; // ignore stray characters
            }
        }
        return blocks;
    },

    /** Build a { points, is3D, length } geometry for a record. */
    buildGeometry(group, G, blocks, headerLength, width, height) {
        switch (group) {
            case '2D':
                return this.buildGeometry2D(G);
            case '3D':
                return this.buildGeometry3D(G);
            case 'WE':
                return this.buildGeometrySpiral(G);
            case 'MA': { // Betonstahlmatte: rectangular mat, length x width.
                const w = width || 100;
                const l = headerLength || 100;
                // Bent drawing mesh: geometry block holds per-bar bend polyline.
                const bent = blocks.Gy || blocks.Gx;
                if (bent && bent.length) {
                    const g = this.buildGeometry2D(bent);
                    if (g.points.length >= 2) return g;
                }
                const pts = [[0, 0, 0], [l, 0, 0], [l, w, 0], [0, w, 0], [0, 0, 0]];
                return { points: pts, is3D: false, length: l };
            }
            case 'GT': { // Gitterträger: side frame, length x height.
                const l = headerLength || 100;
                const h = height || 90;
                const pts = [[0, 0, 0], [l, 0, 0], [l, h, 0], [0, h, 0], [0, 0, 0]];
                return { points: pts, is3D: false, length: l };
            }
            default: { // 'AU' Abstandhalter: straight support bar.
                const l = headerLength || 1000;
                return { points: [[0, 0, 0], [l, 0, 0]], is3D: false, length: l };
            }
        }
    },

    /**
     * BF2D: rebuild the 2D bending shape from l / r / w fields.
     * Always length-or-radius first, then the bend angle.
     * Initial heading is +X; positive angles turn left.
     */
    buildGeometry2D(G) {
        const points = [[0, 0, 0]];
        const angles = [];
        let heading = 0; // radians
        let total = 0;
        let i = 0;
        const fields = G;

        while (i < fields.length) {
            const f = fields[i];
            if (f.id === 'l') {
                const L = parseFloat(f.value);
                if (!isFinite(L)) { i++; continue; }
                const cur = points[points.length - 1];
                points.push([cur[0] + L * Math.cos(heading), cur[1] + L * Math.sin(heading), 0]);
                total += L;
                i++;
                const wField = fields[i];
                if (wField && wField.id === 'w') {
                    const bendAngle = parseFloat(wField.value) || 0;
                    // The bend angle applies to the vertex we just added.
                    if (bendAngle !== 0) angles.push({ pointIndex: points.length - 1, angle: bendAngle });
                    heading += (parseFloat(fields[i].value) || 0) * Math.PI / 180;
                    i++;
                }
            } else if (f.id === 'r') {
                const R = parseFloat(f.value);
                i++;
                const arcW = (fields[i] && fields[i].id === 'w') ? (parseFloat(fields[i].value) || 0) : 0;
                if (fields[i] && fields[i].id === 'w') i++;
                const extraW = (fields[i] && fields[i].id === 'w') ? (parseFloat(fields[i].value) || 0) : 0;
                if (fields[i] && fields[i].id === 'w') i++;
                if (isFinite(R) && R >= 0) {
                    const a = arcW * Math.PI / 180;
                    this.appendArc(points, R, heading, a);
                    total += Math.abs(arcW) * Math.PI / 180 * R;
                    heading += a;
                    if (extraW !== 0) {
                        // Store angle at the end of the arc
                        angles.push({ pointIndex: points.length - 2, angle: extraW });
                    }
                    heading += extraW * Math.PI / 180;
                }
            } else {
                i++;
            }
        }
        return { points, angles, is3D: false, length: total };
    },

    /** Append a circular arc of radius R through signed angle a (radians). */
    appendArc(points, R, heading, a) {
        if (a === 0) return;
        const sign = a >= 0 ? 1 : -1;
        const start = points[points.length - 1];
        // Normal pointing to the turning side (left for positive angles).
        const n = [-Math.sin(heading) * sign, Math.cos(heading) * sign];
        const center = [start[0] + R * n[0], start[1] + R * n[1]];
        const steps = Math.max(8, Math.ceil(Math.abs(a) / (Math.PI / 36)));
        // Vector from center to the arc start point.
        const vx = -R * n[0];
        const vy = -R * n[1];
        for (let k = 1; k <= steps; k++) {
            const phi = a * k / steps;
            const cos = Math.cos(phi);
            const sin = Math.sin(phi);
            points.push([
                center[0] + vx * cos - vy * sin,
                center[1] + vx * sin + vy * cos,
                0
            ]);
        }
    },

    /** BF3D: read x / y / z vector groups into a 3D polyline.
     *
     *  Each x / y / z group is a **direction vector** (relative offset) drawn
     *  from the current point to the next point – NOT an absolute coordinate.
     *  A new vector group begins whenever a fresh 'x' field appears.  If a
     *  coordinate is omitted its vector component defaults to 0.
     *
     *  Example:  Gx-270@y0@z0@x0@y0@z1290@x0@y-370@z0@...
     *    (0,0,0) → (-270,0,0) → (-270,0,1290) → (-270,-370,1290) → ...
     */
    buildGeometry3D(G) {
        // The polyline starts at the origin.
        const points = [[0, 0, 0]];
        // Current vector components (reset to 0 at the start of each group).
        let vec = { x: 0, y: 0, z: 0 };
        let hasVec = false;

        for (const f of G) {
            const v = parseFloat(f.value);
            if (!isFinite(v)) continue;

            if (f.id === 'x') {
                // A new 'x' field starts a new vector group: flush the
                // previous vector by adding it to the last point.
                if (hasVec) {
                    const prev = points[points.length - 1];
                    points.push([prev[0] + vec.x, prev[1] + vec.y, prev[2] + vec.z]);
                }
                vec = { x: v, y: 0, z: 0 };
                hasVec = true;
            } else if (f.id === 'y') {
                vec.y = v;
                hasVec = true;
            } else if (f.id === 'z') {
                vec.z = v;
                hasVec = true;
            }
        }
        // Flush the last pending vector.
        if (hasVec) {
            const prev = points[points.length - 1];
            points.push([prev[0] + vec.x, prev[1] + vec.y, prev[2] + vec.z]);
        }

        if (points.length < 2) { // Fallback for invalid geometry
            return { points: [[0, 0, 0], [1000, 0, 0]], is3D: false, length: 1000 };
        }
        let total = 0;
        for (let i = 1; i < points.length; i++) {
            total += Math.hypot(
                points[i][0] - points[i - 1][0],
                points[i][1] - points[i - 1][1],
                points[i][2] - points[i - 1][2]
            );
        }
        return { points, is3D: true, length: total };
    },

    /** BFWE: planar polygon (l / r / w) plus helical n / g segments. */
    buildGeometrySpiral(G) {
        const plane = [];
        const spiral = [];
        for (const f of G) {
            if (f.id === 'n' || f.id === 'g') spiral.push(f);
            else plane.push(f);
        }
        const base = this.buildGeometry2D(plane);

        // Sum turn / pitch pairs (n = turns, g = pitch).
        let turns = 0;
        let pitch = 0;
        for (let i = 0; i + 1 < spiral.length; i++) {
            if (spiral[i].id === 'n' && spiral[i + 1].id === 'g') {
                turns += parseFloat(spiral[i].value) || 0;
                pitch += parseFloat(spiral[i + 1].value) || 0;
                i++;
            }
        }
        if (turns > 0 && base.points.length >= 3) {
            const pts = this.helixFromPolygon(base.points, turns, pitch);
            return { points: pts, is3D: true, length: base.length };
        }
        return base;
    },

    /**
     * Generate a 3D helix by sweeping the polygon `turns` times around its
     * perimeter while rising `pitch` mm per turn.
     */
    helixFromPolygon(poly, turns, pitch) {
        const n = poly.length;
        const seg = [];
        let perim = 0;
        for (let i = 0; i < n - 1; i++) {
            const L = Math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]);
            seg.push(L);
            perim += L;
        }
        if (perim <= 0) return poly;
        const rise = turns * pitch;
        const samples = Math.max(48, Math.round(turns * 24));
        const pts = [];
        for (let k = 0; k <= samples; k++) {
            const t = k / samples;
            const dist = t * perim;
            let d = 0, s = 0;
            while (s < seg.length - 1 && d + seg[s] < dist) { d += seg[s]; s++; }
            const rem = dist - d;
            const f = seg[s] > 0 ? rem / seg[s] : 0;
            const ax = poly[s][0], ay = poly[s][1];
            const bx = poly[s + 1][0], by = poly[s + 1][1];
            pts.push([ax + (bx - ax) * f, ay + (by - ay) * f, rise * t]);
        }
        return pts;
    },

    /**
     * Validate the BVBS checksum:
     *   IP = 96 - (ASCII sum from sentence start up to and including "C" mod 32)
     * The digits after "C" must equal IP.
     */
    verifyChecksum(text) {
        const m = text.match(/C(\d+)@\s*$/);
        if (!m) return null;
        const idxC = text.lastIndexOf('C');
        let sum = 0;
        for (let i = 0; i <= idxC; i++) sum += text.charCodeAt(i);
        const ip = 96 - (sum % 32);
        return ip === parseInt(m[1], 10);
    }
};

/* =============================================================================
 * 3. Thumbnail Renderer
 * -----------------------------------------------------------------------------
 * Draws a small steel preview for each table row.
 * - Only renders when the canvas is visible (IntersectionObserver).
 * - Caches rendered thumbnails by record id (avoids re-drawing).
 * - Auto-scales and centers the shape with padding.
 * ========================================================================== */

const ThumbnailRenderer = {

    cache: new Map(),

    /** Render a record's shape into a canvas. No-op if already cached. */
    render(canvas, record) { // The record is passed in from the Vue component
        if (!canvas || !record) return;
        if (this.cache.has(record.id)) return;

        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth || 100;
        const h = canvas.clientHeight || 58; // Default thumbnail dimensions
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const points = record.preview && record.preview.points ? record.preview.points : null;
        if (points && points.length >= 2) {
            this.drawShape(ctx, record, points, w, h);
        }
        this.cache.set(record.id, true);
    },

    /** Draw a polyline fit into the canvas with padding. */
    drawShape(ctx, record, points, w, h) {
        const pad = 8;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of points) {
            const x = p[0] || 0, y = p[1] || 0;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        const rangeX = (maxX - minX) || 1;
        const rangeY = (maxY - minY) || 1;
        const scale = Math.min((w - pad * 2) / rangeX, (h - pad * 2) / rangeY);
        const ox = (w - rangeX * scale) / 2 - minX * scale;
        const oy = (h - rangeY * scale) / 2 - minY * scale;
        const toX = x => x * scale + ox;
        const toY = y => y * scale + oy;

        ctx.clearRect(0, 0, w, h);
        ctx.beginPath();
        ctx.moveTo(toX(points[0][0]), toY(points[0][1]));
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(toX(points[i][0]), toY(points[i][1]));
        }

        if (record.type === 'BFMA') {
            // Draw mesh as a filled rectangle
            ctx.closePath();
            ctx.fillStyle = 'rgba(45, 116, 255, 0.5)'; // Blue with 50% opacity
            ctx.strokeStyle = '#c26c06'; // Orange border for mesh
            ctx.lineWidth = 1.5;
            ctx.fill();
            ctx.stroke();
        } else if (record.geometry && record.geometry.is3D) {
            // For 3D shapes, draw the 2D projection on the XY plane for the thumbnail.
            ctx.strokeStyle = '#2d74ff';
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();

        } else if (record.startCoupler) {
            // Draw rebar with coupler as a square start marker
            ctx.strokeStyle = '#2d74ff';
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();
            ctx.fillStyle = '#2d74ff';
            ctx.fillRect(toX(points[0][0]) - 2.5, toY(points[0][1]) - 2.5, 5, 5);
        } else {
            // Draw standard rebar
            ctx.strokeStyle = '#2d74ff';
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();
        }
    }
};

/* =============================================================================
 * 4. 2D Viewer
 * -----------------------------------------------------------------------------
 * Canvas based 2D inspection of the selected bar.
 * Features: mouse wheel zoom (around cursor), drag pan, double-click fit,
 * selection highlight, bounding box, dimensions with arrows, scale bar, grid.
 * ========================================================================== */

const Viewer2D = {

    canvas: null,
    ctx: null,
    record: null,
    transform: { scale: 100, ox: 0, oy: 0 },
    showGrid: true,
    showDimension: true,
    dragging: false,
    lastX: 0,
    lastY: 0,

    /** Attach to a canvas and bind events. */
    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.bindEvents();
        this.resize();
    },

    /** Match the canvas backing store to its CSS size and re-render. */
    resize() {
        if (!this.canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        if (w === 0 || h === 0) return;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.render();
    },

    bindEvents() {
        const c = this.canvas;
        c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        c.addEventListener('mousedown', (e) => this.onMouseDown(e));
        window.addEventListener('mousemove', (e) => this.onMouseMove(e));
        window.addEventListener('mouseup', () => this.onMouseUp());
        c.addEventListener('dblclick', () => this.fit());
    },

    onWheel(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * 0.001);
        const t = this.transform;
        t.scale = clamp(t.scale * factor, 0.0001, 1000000);
        // Zoom around the cursor position.
        t.ox = mx - (mx - t.ox) * factor;
        t.oy = my - (my - t.oy) * factor;
        this.render();
    },

    onMouseDown(e) {
        if (e.button !== 0) return;
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
    },

    onMouseMove(e) {
        if (!this.dragging) return;
        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.transform.ox += dx;
        this.transform.oy += dy;
        this.render();
    },

    onMouseUp() {
        this.dragging = false;
        this.canvas.style.cursor = 'grab';
    },

    /** Set the record to display and fit it. */
    setRecord(record) {
        if (this.record === record) return; // Avoid re-fitting if the same record is selected
        this.record = record;
        this.fit();
    },

    /** Fit the current record into the viewport with padding. */
    fit() {
        const displayPts = this.currentPoints();
        if (!displayPts || displayPts.length < 2) return;
        const b = this.record.bounds; // Use original bounds for fitting
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        const pad = 70;
        const rangeX = (b.maxX - b.minX) || 1;
        const rangeY = (b.maxY - b.minY) || 1;
        const scale = Math.min((w - pad * 2) / rangeX, (h - pad * 2) / rangeY);
        this.transform.scale = Math.max(scale, 0.0001);
        this.transform.ox = (w - rangeX * this.transform.scale) / 2 - b.minX * this.transform.scale;
        this.transform.oy = (h - rangeY * this.transform.scale) / 2 - b.minY * this.transform.scale;
        this.render();
    },

    currentPoints() {
        // Returns the points for DISPLAY purposes
        if (!this.record || !this.record.preview) return null;
        return this.record.preview.points;

    },

    toScreen(p) {
        const t = this.transform;
        return { x: p[0] * t.scale + t.ox, y: p[1] * t.scale + t.oy };
    },

    toWorld(sx, sy) {
        const t = this.transform;
        return { x: (sx - t.ox) / t.scale, y: (sy - t.oy) / t.scale };
    },

    /** Full redraw of the 2D canvas. */
    render() {
        const ctx = this.ctx;
        if (!ctx) return;
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#fafbfc';
        ctx.fillRect(0, 0, w, h);

        if (this.showGrid) this.drawGrid(ctx, w, h);

        const pts = this.currentPoints();
        const originalPts = this.record ? this.record.geometry.points : null;

        if (!pts || pts.length < 2 || !originalPts) {
            this.drawEmpty(ctx, w, h);
            return;
        }

        this.drawBounds(ctx, pts);
        this.drawBar(ctx, pts);
        if (this.showDimension) this.drawBendAngles(ctx, originalPts);
        if (this.showDimension) this.drawDimensions(ctx, pts);
        this.drawScaleBar(ctx, w, h);
    },

    drawEmpty(ctx, w, h) {
        ctx.fillStyle = '#97a2b5';
        ctx.font = '14px Segoe UI, Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Select a position to view', w / 2, h / 2);
    },

    drawGrid(ctx, w, h) {
        const t = this.transform;
        const target = 40 / t.scale;
        const step = niceStep(target);
        ctx.strokeStyle = '#e8ecf2';
        ctx.lineWidth = 1;
        const world = this.toWorld(w, h);
        const x0 = Math.floor(-t.ox / t.scale / step) * step;
        const y0 = Math.floor(-t.oy / t.scale / step) * step;
        for (let x = x0; x < world.x; x += step) {
            const sx = t.ox + x * t.scale;
            ctx.beginPath();
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, h);
            ctx.stroke();
        }
        for (let y = y0; y < world.y; y += step) {
            const sy = t.oy + y * t.scale;
            ctx.beginPath();
            ctx.moveTo(0, sy);
            ctx.lineTo(w, sy);
            ctx.stroke();
        }
    },

    drawBounds(ctx, pts) {
        const b = computeBounds(pts);
        const tl = this.toScreen([b.minX, b.minY]);
        const br = this.toScreen([b.maxX, b.maxY]);
        ctx.strokeStyle = '#aab5c5';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        ctx.setLineDash([]);
    },

    drawBar(ctx, pts) {
        ctx.beginPath();
        const s0 = this.toScreen(pts[0]);
        ctx.moveTo(s0.x, s0.y);
        for (let i = 1; i < pts.length; i++) {
            const p = this.toScreen(pts[i]);
            ctx.lineTo(p.x, p.y);
        }

        if (this.record && this.record.type === 'BFMA') {
            ctx.closePath();
            ctx.fillStyle = 'rgba(45, 116, 255, 0.5)';
            ctx.strokeStyle = '#195de0';
            ctx.lineWidth = 2;
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.strokeStyle = '#2d74ff';
            ctx.lineWidth = 3;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();

            // Vertex markers for rebar.
            ctx.fillStyle = '#195de0';
            for (const p of pts) {
                const sp = this.toScreen(p);
                ctx.beginPath();
                ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI * 2);
                ctx.fill();
            }

            // Start marker (red) for rebar.
            ctx.fillStyle = '#df3c3c';
            ctx.beginPath();
            ctx.arc(s0.x, s0.y, 4.5, 0, Math.PI * 2);
            ctx.fill();

            // Draw coupler markers if they exist
            if (this.record.startCoupler) {
                ctx.fillStyle = '#c26c06';
                ctx.fillRect(s0.x - 5, s0.y - 5, 10, 10);
                const label = this.record.startCoupler.type;
                const x = s0.x;
                const y = s0.y - 15;
                ctx.font = 'bold 11px Segoe UI, Arial';
                ctx.textAlign = 'center';
                const tw = ctx.measureText(label).width;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                ctx.fillRect(x - tw / 2 - 3, y - 8, tw + 6, 16);
                ctx.fillStyle = '#252a34';
                ctx.fillText(label, x, y);
            }
            if (this.record.endCoupler) {
                const s_end = this.toScreen(pts[pts.length - 1]);
                ctx.fillStyle = '#c26c06';
                ctx.fillRect(s_end.x - 5, s_end.y - 5, 10, 10);
                const label = this.record.endCoupler.type;
                const x = s_end.x;
                const y = s_end.y - 15;
                ctx.font = 'bold 11px Segoe UI, Arial';
                ctx.textAlign = 'center';
                const tw = ctx.measureText(label).width;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                ctx.fillRect(x - tw / 2 - 3, y - 8, tw + 6, 16);
                ctx.fillStyle = '#252a34';
                ctx.fillText(label, x, y);
            }
        }
    },

    drawDimensions(ctx, pts) {
        const b = computeBounds(pts);

        // Centroid of the polyline – dimension labels are offset AWAY from
        // the centroid so they stay on the OUTSIDE of the shape.  For closed
        // loops (e.g. rectangular stirrups) this prevents dimension lines
        // from overlapping inside the reinforcement.
        let cx = 0;
        let cy = 0;
        for (const p of pts) {
            cx += p[0] || 0;
            cy += p[1] || 0;
        }
        if (pts.length) {
            cx /= pts.length;
            cy /= pts.length;
        }

        if (this.record && this.record.type === 'BFMA') {
            // For mesh, show overall length and width dimensions.
            this.drawDimension(ctx, [b.minX, b.minY], [b.maxX, b.minY], fmtLength(b.maxX - b.minX), 28, cx, cy);
            this.drawDimension(ctx, [b.maxX, b.minY], [b.maxX, b.maxY], fmtLength(b.maxY - b.minY), 28, cx, cy);
        } else {
            const originalPts = this.record.geometry.points;

            // Segment dimensions for rebar.
            for (let i = 1; i < pts.length; i++) {
                const a = pts[i - 1];
                const c = pts[i];
                // Get original length for the label
                const len = Math.hypot(originalPts[i][0] - originalPts[i-1][0], originalPts[i][1] - originalPts[i-1][1]);
                if (len > 0) {
                    this.drawDimension(ctx, a, c, fmtLength(len), 16, cx, cy);
                }
            }
        }
    },

    /** Draw a dimension line with extension lines, arrows and a label.
     *  The line is offset perpendicular to the segment.  When a centroid
     *  (cx, cy) is supplied, the offset side is chosen so the dimension
     *  sits OUTSIDE the shape (away from the centroid). */
    drawDimension(ctx, a, b, label, perpOffset, cx, cy) {
        const pa = this.toScreen(a);
        const pb = this.toScreen(b);
        const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);

        // Perpendicular direction to the segment (two possible sides).
        let nx = -Math.sin(ang);
        let ny = Math.cos(ang);

        // Flip to the side pointing away from the shape centroid.
        if (typeof cx === 'number' && typeof cy === 'number') {
            const mx = (a[0] + b[0]) / 2;
            const my = (a[1] + b[1]) / 2;
            const outX = mx - cx;
            const outY = my - cy;
            if (nx * outX + ny * outY < 0) {
                nx = -nx;
                ny = -ny;
            }
        }

        const d1 = { x: pa.x + nx * perpOffset, y: pa.y + ny * perpOffset };
        const d2 = { x: pb.x + nx * perpOffset, y: pb.y + ny * perpOffset };

        ctx.strokeStyle = '#8a94a6';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(d1.x, d1.y);
        ctx.moveTo(pb.x, pb.y);
        ctx.lineTo(d2.x, d2.y);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(d1.x, d1.y);
        ctx.lineTo(d2.x, d2.y);
        ctx.stroke();

        this.drawArrowHead(ctx, d1.x, d1.y, ang);
        this.drawArrowHead(ctx, d2.x, d2.y, ang + Math.PI);

        const mx = (d1.x + d2.x) / 2;
        const my = (d1.y + d2.y) / 2;
        ctx.font = '12px Segoe UI, Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.fillRect(mx - tw / 2 - 3, my - 9, tw + 6, 18);
        ctx.fillStyle = '#252a34';
        ctx.fillText(label, mx, my + 1);
    },

    drawBendAngles(ctx, pts) {
        if (!pts || pts.length < 3) return;

        ctx.font = 'bold 11px Segoe UI, Arial';
        ctx.fillStyle = '#c26c06'; // Orange color for angle text
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const originalPts = this.record.geometry.points;
        for (let i = 1; i < originalPts.length - 1; i++) {
            const p0 = originalPts[i - 1];
            const p1 = originalPts[i];
            const p2 = originalPts[i + 1];

            const v1 = [p0[0] - p1[0], p0[1] - p1[1]]; // Use original points for angle calculation
            const v2 = [p2[0] - p1[0], p2[1] - p1[1]];

            const dot = v1[0] * v2[0] + v1[1] * v2[1];
            const det = v1[0] * v2[1] - v1[1] * v2[0]; // For sign
            const angleRad = Math.acos(dot / (Math.hypot(...v1) * Math.hypot(...v2)));
            let angleDeg = angleRad * 180 / Math.PI;

            // Only show angles that are not 90 degrees (with a small tolerance)
            if (Math.abs(angleDeg - 90) < 0.1) continue;

            const p = this.toScreen(pts[i]); // Use display points for label position
            const label = `${angleDeg.toFixed(1)}°`;
            const x = p.x + 12;
            const y = p.y - 12;
            this.drawTextWithBackground(ctx, label, x, y, '#c26c06');
        }
    },

    drawArrowHead(ctx, x, y, ang) {
        const size = 7;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-size, -size * 0.5);
        ctx.lineTo(-size, size * 0.5);
        ctx.closePath();
        ctx.fillStyle = '#8a94a6';
        ctx.fill();
        ctx.restore();
    },

    drawTextWithBackground(ctx, text, x, y, color) {
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillRect(x, y - 8, tw + 6, 16);
        ctx.fillStyle = color;
        ctx.fillText(text, x + 3, y);
    },

    drawScaleBar(ctx, w, h) {
        const t = this.transform;
        const target = 100 / t.scale;
        const step = niceStep(target);
        const px = t.scale * step;
        const x = w - 20 - px;
        const y = h - 20;
        ctx.strokeStyle = '#252a34';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + px, y);
        ctx.stroke();
        ctx.font = '11px Segoe UI, Arial';
        ctx.fillStyle = '#252a34';
        ctx.textAlign = 'center';
        ctx.fillText(fmtLength(step), x + px / 2, y - 5);
    }
};

/* =============================================================================
 * 5. 3D Viewer
 * -----------------------------------------------------------------------------
 * Three.js scene with a custom orbit control (the bundled three.min.js does
 * NOT include OrbitControls). Supports perspective camera, grid, axes, tube
 * geometry, auto-fit, and optional bounding box.
 * ========================================================================== */

/** Lightweight orbit controls (rotate / pan / dolly). */
const OrbitControls = {
    camera: null,
    domElement: null,
    target: null, // lazily created in attach() so THREE can be guarded
    spherical: { radius: 100, theta: 0.8, phi: 1.2 },
    minDistance: 0.1,
    maxDistance: 100000,
    isDragging: false,
    button: -1,
    lastX: 0,
    lastY: 0,
    _handlers: [],

    attach(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement;
        this.target = new THREE.Vector3();

        const onDown = (e) => this.onMouseDown(e);
        const onMove = (e) => this.onMouseMove(e);
        const onUp = () => this.onMouseUp();
        const onWheel = (e) => this.onWheel(e);
        const onCtx = (e) => e.preventDefault();
        const onTouchStart = (e) => this.onTouchStart(e);
        const onTouchMove = (e) => this.onTouchMove(e);
        const onTouchEnd = () => this.onTouchEnd();

        domElement.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        domElement.addEventListener('wheel', onWheel, { passive: false });
        domElement.addEventListener('contextmenu', onCtx);
        domElement.addEventListener('touchstart', onTouchStart, { passive: false });
        domElement.addEventListener('touchmove', onTouchMove, { passive: false });
        domElement.addEventListener('touchend', onTouchEnd);

        this._handlers = { onDown, onMove, onUp, onWheel, onCtx, onTouchStart, onTouchMove, onTouchEnd };
        this.update();
    },

    detach() {
        if (!this.domElement || !this._handlers.length) return;
        const h = this._handlers;
        this.domElement.removeEventListener('mousedown', h.onDown);
        window.removeEventListener('mousemove', h.onMove);
        window.removeEventListener('mouseup', h.onUp);
        this.domElement.removeEventListener('wheel', h.onWheel);
        this.domElement.removeEventListener('contextmenu', h.onCtx);
        this.domElement.removeEventListener('touchstart', h.onTouchStart);
        this.domElement.removeEventListener('touchmove', h.onTouchMove);
        this.domElement.removeEventListener('touchend', h.onTouchEnd);
        this._handlers = [];
    },

    onMouseDown(e) {
        this.button = e.button;
        this.isDragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
    },

    onMouseMove(e) {
        if (!this.isDragging) return;
        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        if (this.button === 0) this.rotate(dx, dy);
        else if (this.button === 1 || this.button === 2) this.pan(dx, dy);
        this.update();
    },

    onMouseUp() {
        this.isDragging = false;
        this.domElement.style.cursor = 'grab';
    },

    onWheel(e) {
        e.preventDefault();
        const factor = Math.exp(e.deltaY * 0.001);
        this.spherical.radius = clamp(this.spherical.radius * factor, this.minDistance, this.maxDistance);
        this.update();
    },

    onTouchStart(e) {
        e.preventDefault();
        if (e.touches.length === 1) {
            this.button = 0;
            this.isDragging = true;
            this.lastX = e.touches[0].clientX;
            this.lastY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            this.isDragging = false;
            this._pinchDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
        }
    },

    onTouchMove(e) {
        e.preventDefault();
        if (e.touches.length === 1 && this.isDragging) {
            const dx = e.touches[0].clientX - this.lastX;
            const dy = e.touches[0].clientY - this.lastY;
            this.lastX = e.touches[0].clientX;
            this.lastY = e.touches[0].clientY;
            this.rotate(dx, dy);
            this.update();
        } else if (e.touches.length === 2 && this._pinchDist) {
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const factor = this._pinchDist / dist;
            this.spherical.radius = clamp(this.spherical.radius * factor, this.minDistance, this.maxDistance);
            this._pinchDist = dist;
            this.update();
        }
    },

    onTouchEnd() {
        this.isDragging = false;
        this._pinchDist = null;
    },

    rotate(dx, dy) {
        this.spherical.theta += dx * 0.005;
        this.spherical.phi -= dy * 0.005;
        this.spherical.phi = clamp(this.spherical.phi, 0.05, Math.PI - 0.05);
    },

    pan(dx, dy) {
        if (!this.target) return;
        const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
        const scale = this.spherical.radius * 0.001;
        right.multiplyScalar(-dx * scale);
        up.multiplyScalar(dy * scale);
        this.target.add(right).add(up);
    },

    update() {
        if (!this.target || !this.camera) return;
        const { radius, theta, phi } = this.spherical;
        const pos = new THREE.Vector3(
            radius * Math.sin(phi) * Math.cos(theta),
            radius * Math.cos(phi),
            radius * Math.sin(phi) * Math.sin(theta)
        );
        pos.add(this.target);
        this.camera.position.copy(pos);
        this.camera.lookAt(this.target);
    },

    setTarget(v) {
        if (!this.target) return;
        this.target.copy(v);
        this.update();
    },

    /** Fit the camera to a THREE.Box3. */
    fitToBounds(box) {
        if (!this.target || !box || box.isEmpty()) return;
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        if (size.length() === 0) return; // Avoid issues with zero-sized boxes
        this.target.copy(center);
        this.spherical.radius = Math.max(size.length() * 1.3, 1);
        this.update();
    }
};

/* =============================================================================
 * 6. Vue Application
 * ========================================================================== */

const app = Vue.createApp({
    data() {
        return {
            files: [],
            allRecords: [],
            expandedFiles: {},   // file.path -> true when its table is open
            selectedRecord: null,
            projectName: 'ABS Viewer',
            allFilesExpanded: true,
            status: 'Ready',
            viewerMode: '2d',
            showDimension: true,
            loading: false,
            thumbnailObserver: null,
            recordIndex: null,
            // 3D state
            scene3D: null,
            camera3D: null,
            renderer3D: null,
            group3D: null,
            axesHelper3D: null,
            dimBox3D: null,
            orbit3D: null,
            rafId: null,
            // Persistent segment dimension labels (HTML overlay)
            segmentLabelEls: [],
            segmentLabelMids: [],
            // Resizable panels
            rightPanelWidth: 430,
            viewerHeight: 400,
            _resizeMode: null,
            _startX: 0,
            _startY: 0,
            _startWidth: 0,
            _startHeight: 0
        };
    },

    computed: {
        totalWeight() {
            // Header "e" is the weight of one bar; multiply by quantity.
            return this.allRecords.reduce((sum, r) => sum + ((r.weight || 0) * (r.quantity || 1)), 0);
        },
        totalBars() {
            return this.allRecords.reduce((sum, r) => sum + (r.quantity || 0), 0);
        },
        recordCount() {
            return this.allRecords.length;
        },
        barCountByDiameter() {
            const map = {};
            for (const r of this.allRecords) {
                const d = r.diameter || 0;
                map[d] = (map[d] || 0) + (r.quantity || 0);
            }
            return map;
        }
    },

    methods: {
        /* ------------------------------------------------------------------
         * PyWebView bridge
         * ---------------------------------------------------------------- */

        async openABS() {
            const api = getApi();
            if (api) {
                this.status = 'Opening files...';
                try {
                    const result = await api.open_abs_files();
                    if (result && result.length) {
                        this.addFiles(result);
                    } else {
                        this.status = 'No files selected';
                    }
                } catch (e) {
                    this.status = 'Failed to open files';
                    console.error(e);
                    notify('Failed to open files', 'error');
                }
            } else {
                // Browser fallback: use a file input.
                this.openViaBrowser();
            }
        },

        async reloadCurrent() {
            if (!this.files.length) {
                this.status = 'No files loaded';
                return;
            }
            const api = getApi();
            if (!api) {
                this.status = 'PyWebView not available';
                return;
            }
            this.status = 'Reloading all files...';
            try {
                const kept = [];
                for (const raw of this.files) {
                    if (raw.path) {
                        const file = await api.reload_file(raw.path);
                        if (file && file.text) {
                            kept.push({ ...raw, ...file });
                        }
                    }
                }
                if (!kept.length) {
                    this.status = 'Reload failed';
                    notify('Reload failed', 'error');
                    return;
                }
                // Re-parse every file from scratch into a clean record pool
                // and refresh the cached per-file aggregates.
                const all = [];
                this.files = [];
                for (const file of kept) {
                    const parsed = ABSParser.parse(file.text, file.name, file.index);
                    // Sort records: rebar first, then mesh, then by position.
                    parsed.records.sort((a, b) => {
                        const isAMesh = a.type === 'BFMA';
                        const isBMesh = b.type === 'BFMA';
                        if (isAMesh && !isBMesh) {
                            return 1; // a (mesh) comes after b (rebar)
                        }
                        if (!isAMesh && isBMesh) {
                            return -1; // a (rebar) comes before b (mesh)
                        }
                        return String(a.position).localeCompare(String(b.position), undefined, { numeric: true });
                    });
                    file.records = parsed.records;
                    // Cache per-file aggregates.
                    const totalWeight = parsed.records.reduce((s, r) => s + r.weightTotal, 0);
                    const rebarWeight = parsed.records.filter(r => r.type !== 'BFMA').reduce((s, r) => s + r.weightTotal, 0);
                    const meshWeight = totalWeight - rebarWeight;
                    file.weight = totalWeight;
                    file.rebarWeight = rebarWeight;
                    file.meshWeight = meshWeight;
                    file.bars = parsed.records.reduce((s, r) => s + (r.quantity || 0), 0);

                    this.files.push(file);
                    all.push(...parsed.records);
                }
                this.allRecords = all;
                ThumbnailRenderer.cache.clear();
                this.buildRecordIndex();
                this.status = `Reloaded ${this.files.length} file(s)`;
                this.$nextTick(() => this.setupThumbnailObserver());
            } catch (e) {
                this.status = 'Reload error';
                console.error(e);
            }
        },

        async loadSettings() {
            const api = getApi();
            if (!api) return;
            try {
                const settings = await api.get_settings();
                if (settings && settings.projectName) {
                    this.projectName = settings.projectName;
                }
            } catch (e) {
                console.warn('loadSettings failed', e);
            }
        },

        async saveSettings() {
            const api = getApi();
            if (!api) return;
            try {
                await api.save_settings({
                    projectName: this.projectName
                });
            } catch (e) {
                console.warn('saveSettings failed', e);
            }
        },

        /* ------------------------------------------------------------------
         * File handling
         * ---------------------------------------------------------------- */

        /** Merge parsed files into the project. */
        addFiles(newFiles) {
            for (const raw of newFiles) {
                if (!raw.text) continue;
                const index = this.files.length;
                const parsed = ABSParser.parse(raw.text, raw.name, index);
                // Sort records: rebar first, then mesh, then by position.
                parsed.records.sort((a, b) => {
                    const isAMesh = a.type === 'BFMA';
                    const isBMesh = b.type === 'BFMA';
                    if (isAMesh && !isBMesh) {
                        return 1; // a (mesh) comes after b (rebar)
                    }
                    if (!isAMesh && isBMesh) {
                        return -1; // a (rebar) comes before b (mesh)
                    }
                    return String(a.position).localeCompare(String(b.position), undefined, { numeric: true });
                });
                // Cache per-file aggregates to avoid repeated filtering.
                const totalWeight = parsed.records.reduce((s, r) => s + r.weightTotal, 0);
                const rebarWeight = parsed.records.filter(r => r.type !== 'BFMA').reduce((s, r) => s + r.weightTotal, 0);
                const meshWeight = totalWeight - rebarWeight;
                const file = {
                    ...raw,
                    index,
                    records: parsed.records,
                    rebarWeight: rebarWeight,
                    meshWeight: meshWeight,
                    weight: totalWeight, // Keep total for compatibility if needed elsewhere
                    bars: parsed.records.reduce((s, r) => s + (r.quantity || 0), 0)
                };
                this.files.push(file);
                this.allRecords = this.allRecords.concat(parsed.records);
                if (!this.projectName || this.projectName === 'ABS Viewer') {
                    this.projectName = parsed.projectName || raw.name;
                }
                // Newly added files start expanded so the user sees content.
                this.expandedFiles[raw.path] = true;
            }
            this.buildRecordIndex();
            this.status = `${this.allRecords.length} positions loaded`;
            this.updateViewer();
            this.saveSettings();
            this.$nextTick(() => this.setupThumbnailObserver());
        },

        /* ------------------------------------------------------------------
         * Per-file toggle helpers
         * ---------------------------------------------------------------- */

        /** Toggle the expanded state of a file group. */
        toggleFile(file) {
            const key = file.path;
            if (this.expandedFiles[key]) {
                delete this.expandedFiles[key];
            } else {
                this.expandedFiles[key] = true;
                // Render thumbnails of the newly shown table immediately.
                this.$nextTick(() => this.setupThumbnailObserver());
            }
        },

        /** True if the file's table is currently expanded. */
        isFileExpanded(file) {
            return !!this.expandedFiles[file.path];
        },

        /** Records belonging to one file (cached at parse time). */
        fileRecords(file) {
            return file.records || [];
        },

        /** Total weight (kg) of one file (cached at parse time). */
        fileWeight(file) {
            return file.weight || 0;
        },

        /** Total rebar weight (kg) of one file (cached at parse time). */
        fileRebarWeight(file) {
            return file.rebarWeight || 0;
        },

        /** Total mesh weight (kg) of one file (cached at parse time). */
        fileMeshWeight(file) {
            return file.meshWeight || 0;
        },

        /** Total bar count of one file (cached at parse time). */
        fileBars(file) {
            return file.bars || 0;
        },

        /** Number of rebar positions (non-BFMA) in a file. */
        fileRebarCount(file) {
            return (file.records || []).filter(r => r.type !== 'BFMA').length;
        },

        /** Number of mesh positions (BFMA) in a file. */
        fileMeshCount(file) {
            return (file.records || []).filter(r => r.type === 'BFMA').length;
        },

        /** Total quantity of rebar (non-BFMA) in a file. */
        fileRebarQty(file) {
            return (file.records || [])
                .filter(r => r.type !== 'BFMA')
                .reduce((s, r) => s + (r.quantity || 0), 0);
        },

        /** Total quantity of mesh (BFMA) in a file. */
        fileMeshQty(file) {
            return (file.records || [])
                .filter(r => r.type === 'BFMA')
                .reduce((s, r) => s + (r.quantity || 0), 0);
        },

        /** Total number of start couplers in a file. */
        fileStartCouplerCount(file) {
            return (file.records || [])
                .filter(r => r.startCoupler)
                .reduce((s, r) => s + (r.quantity || 0), 0);
        },

        /** Total number of end couplers in a file. */
        fileEndCouplerCount(file) {
            return (file.records || [])
                .filter(r => r.endCoupler)
                .reduce((s, r) => s + (r.quantity || 0), 0);
        },

        /** The dominant (most common) grade among rebar in a file. */
        fileDominantGrade(file) {
            const map = {};
            for (const r of (file.records || [])) {
                if (r.type === 'BFMA') continue;
                const g = r.grade || '';
                if (!g) continue;
                map[g] = (map[g] || 0) + (r.quantity || 1);
            }
            let best = '';
            let bestQty = 0;
            for (const g in map) {
                if (map[g] > bestQty) {
                    bestQty = map[g];
                    best = g;
                }
            }
            return best;
        },

        /** True if this record's grade differs from the file's dominant grade. */
        isGradeDifferent(file, item) {
            if (!file || !item || item.type === 'BFMA') return false;
            const dom = this.fileDominantGrade(file);
            if (!dom) return false;
            return (item.grade || '') !== dom;
        },

        /** Convert a length in mm to a clean cm value. */
        fmtCm(mm) {
            const v = (mm || 0) / 10;
            return Math.round(v * 100) / 100;
        },

        /** Display the bar diameter (round bar) or mesh code (mesh). */
        diaDisplay(rec) {
            if (!rec) return '';
            if (rec.type === 'BFMA') {
                // Mesh: show the mesh code, e.g. Q125A or BT16.
                return rec.matType || '';
            }
            return 'Ø' + rec.diameter;
        },

        /** Select a record in the table. */
        selectRecord(item) {
            this.selectedRecord = item;
            this.updateViewer();
        },

        /** Toggle expand/collapse for all file tables. */
        toggleAllFiles() {
            if (this.allFilesExpanded) {
                // Collapse all
                this.expandedFiles = {};
            } else {
                // Expand all
                const newExpanded = {};
                for (const file of this.files) {
                    newExpanded[file.path] = true;
                }
                this.expandedFiles = newExpanded;
            }
            this.allFilesExpanded = !this.allFilesExpanded;
            this.$nextTick(() => this.setupThumbnailObserver());
        },
        clearProject() {
            this.files = [];
            this.allRecords = [];
            this.expandedFiles = {};
            this.selectedRecord = null;
            this.projectName = 'ABS Viewer';
            this.status = 'Ready';
            this.allFilesExpanded = true;
            ThumbnailRenderer.cache.clear();
            this.recordIndex = null;
            Viewer2D.record = null; // Clear the 2D viewer content too.
            this.clear3DGroup();
            Viewer2D.render();
            this.$nextTick(() => this.setupThumbnailObserver());
        },

        /* ------------------------------------------------------------------
         * Browser fallback (no pywebview)
         * ---------------------------------------------------------------- */

        openViaBrowser() {
            let input = document.getElementById('hidden-file-input');
            if (!input) {
                input = document.createElement('input');
                input.type = 'file';
                input.id = 'hidden-file-input';
                input.multiple = true;
                input.accept = '.abs';
                input.style.display = 'none';
                document.body.appendChild(input);
                input.addEventListener('change', () => {
                    const fileList = Array.from(input.files || []);
                    if (!fileList.length) return;
                    const readers = fileList.map(f => this.readFileAsText(f));
                    Promise.all(readers).then(texts => {
                        const results = fileList.map((f, i) => ({
                            name: f.name,
                            path: f.name,
                            folder: '',
                            size: f.size,
                            text: texts[i]
                        }));
                        this.addFiles(results);
                    });
                    input.value = '';
                });
            }
            input.click();
        },

        readFileAsText(file) {
            return new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => resolve('');
                reader.readAsText(file);
            });
        },

        /* ------------------------------------------------------------------
         * Viewer integration
         * ---------------------------------------------------------------- */

        updateViewer() {
            if (this.viewerMode === '2d') {
                Viewer2D.setRecord(this.selectedRecord);
            } else {
                this.render3D(this.selectedRecord);
            }
        },

        fitView() {
            if (this.viewerMode === '2d') {
                Viewer2D.fit(); 
            } else {
                this.orbit3D.fitToBounds(new THREE.Box3().setFromObject(this.group3D));
            }
        },

        toggleDimension() {
            this.showDimension = !this.showDimension;
            const segmentLabels = document.getElementById('segment-labels');
            if (this.viewerMode === '3d' && segmentLabels) {
                segmentLabels.style.display = this.showDimension ? '' : 'none';
            } else {
                Viewer2D.showDimension = this.showDimension;
                Viewer2D.render();
            }
            if (this.viewerMode === '3d') {
                this.render3D(this.selectedRecord, false); // Don't force fit on dimension toggle
            } else {
                Viewer2D.render();
            }
        },

        /* ------------------------------------------------------------------
         * Thumbnails (lazy, visible-only)
         * ---------------------------------------------------------------- */

        /** Build a fast id -> record lookup map to avoid O(n) array scans. */
        buildRecordIndex() {
            this.recordIndex = {};
            for (const r of this.allRecords) {
                this.recordIndex[r.id] = r;
            }
        },

        setupThumbnailObserver() {
            if (this.thumbnailObserver) this.thumbnailObserver.disconnect();
            const container = document.querySelector('.center-panel');
            if (!container) return;

            const renderOne = (canvas) => {
                const id = canvas.id.replace('thumb_', '');
                const record = this.recordIndex ? this.recordIndex[id] : null;
                if (record) ThumbnailRenderer.render(canvas, record); // Pass record to renderer
            };

            if (typeof IntersectionObserver === 'undefined') {
                // Fallback for embedded WebView environments: render all
                // thumbnails once (still cached, so no repeated rendering).
                document.querySelectorAll('.thumb').forEach(renderOne);
                return;
            }

            this.thumbnailObserver = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    renderOne(entry.target);
                }
            }, { root: container, rootMargin: '60px' });

            document.querySelectorAll('.thumb').forEach(c => this.thumbnailObserver.observe(c));
        },

        /* ------------------------------------------------------------------
         * 2D init
         * ---------------------------------------------------------------- */

        init2D() {
            const canvas = document.getElementById('viewer2d');
            if (canvas) Viewer2D.init(canvas);
        },

        /* ------------------------------------------------------------------
         * Resizers (drag to resize right-panel width / viewer height)
         * ---------------------------------------------------------------- */

        initResizers() {
            const panelResizer = document.querySelector('.resizer-vertical-right-panel');
            const viewerResizer = document.querySelector('.resizer-horizontal-viewer');

            if (panelResizer) {
                panelResizer.addEventListener('mousedown', (e) => this.startResizePanel(e));
            }
            if (viewerResizer) {
                viewerResizer.addEventListener('mousedown', (e) => this.startResizeViewer(e));
            }
            window.addEventListener('mousemove', (e) => this.onResizeMove(e));
            window.addEventListener('mouseup', () => this.endResize());
        },

        startResizePanel(e) {
            e.preventDefault();
            this._resizeMode = 'panel';
            this._startX = e.clientX;
            this._startWidth = this.rightPanelWidth;
            const el = document.querySelector('.resizer-vertical-right-panel');
            if (el) el.classList.add('active');
        },

        startResizeViewer(e) {
            e.preventDefault();
            this._resizeMode = 'viewer';
            this._startY = e.clientY;
            this._startHeight = this.viewerHeight;
            const el = document.querySelector('.resizer-horizontal-viewer');
            if (el) el.classList.add('active');
        },

        onResizeMove(e) {
            if (this._resizeMode === 'panel') {
                // The resizer sits on the LEFT edge of the right-panel.
                // Dragging LEFT (dx < 0) widens the panel; dragging RIGHT
                // (dx > 0) narrows it – so we subtract dx.
                const dx = e.clientX - this._startX;
                const w = clamp(this._startWidth - dx, 350, 600);
                this.rightPanelWidth = w;
                document.documentElement.style.setProperty('--right-width', w + 'px');
                this.onResize();
            } else if (this._resizeMode === 'viewer') {
                const dy = e.clientY - this._startY;
                const h = clamp(this._startHeight + dy, 400, 600);
                this.viewerHeight = h;
                const viewer = document.querySelector('.viewer');
                if (viewer) {
                    viewer.style.height = h + 'px';
                    viewer.style.flex = '0 0 auto';
                }
                this.onResize();
            }
        },

        endResize() {
            this._resizeMode = null;
            document.querySelectorAll('.resizer-vertical-right-panel, .resizer-horizontal-viewer')
                .forEach(el => el.classList.remove('active'));
            // Re-fit the active viewer after the drag so the content is
            // regenerated at the new aspect ratio (avoids distortion).
            this.$nextTick(() => {
                if (this.viewerMode === '2d') { 
                    Viewer2D.resize(); 
                } else { 
                    this.onResize3D(); 
                }
            });
        },

        /* ------------------------------------------------------------------
         * 3D init / render / dispose
         * ---------------------------------------------------------------- */

        init3D() {
            const container = document.getElementById('viewer3d');
            if (!container) return;

            // markRaw prevents Vue from making Three.js objects reactive
            // (reactive proxies break Three.js internal getters/setters).
            const mark = Vue.markRaw;

            const scene = mark(new THREE.Scene());
            scene.background = new THREE.Color(0xeef2f7);

            const camera = mark(new THREE.PerspectiveCamera(45, 1, 0.1, 50000));
            camera.position.set(100, 100, 100);

            const renderer = mark(new THREE.WebGLRenderer({ antialias: true }));
            renderer.setPixelRatio(window.devicePixelRatio || 1);
            container.appendChild(renderer.domElement);

            // Grid + axes.
            const grid = mark(new THREE.GridHelper(1000, 20, 0x9aa7b8, 0xc8d2e0));
            grid.visible = false; // Default grid to hidden in 3D
            scene.add(grid);
            const axes = mark(new THREE.AxesHelper(100));
            scene.add(axes);

            // Lights.
            const ambient = mark(new THREE.AmbientLight(0xffffff, 0.6));
            scene.add(ambient);
            const dir = mark(new THREE.DirectionalLight(0xffffff, 0.8));
            dir.position.set(1, 2, 1);
            scene.add(dir);

            const group = mark(new THREE.Group());
            scene.add(group);

            this.scene3D = scene;
            this.camera3D = camera;
            this.renderer3D = renderer;
            this.axesHelper3D = axes;
            this.group3D = group;

            this.orbit3D = mark(Object.create(OrbitControls));
            this.orbit3D.attach(camera, renderer.domElement);

            this.onResize3D();
            this.animate3D();
        },

        onResize3D() {
            if (!this.renderer3D) return;
            const container = document.getElementById('viewer3d');
            if (!container) return;
            const w = container.clientWidth;
            const h = container.clientHeight;
            if (w === 0 || h === 0) return;
            this.camera3D.aspect = w / h;
            this.camera3D.updateProjectionMatrix();
            this.renderer3D.setSize(w, h);
        },

        animate3D() {
            if (!this.renderer3D) return;
            this.updateSegmentLabels();
            this.renderer3D.render(this.scene3D, this.camera3D);
            this.rafId = requestAnimationFrame(() => this.animate3D());
        },

        /** Remove the current 3D bar group and dispose its resources. */
        clear3DGroup() {
            if (this.group3D && this.scene3D) {
                this.scene3D.remove(this.group3D);
                this.group3D.traverse(obj => {
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) {
                        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                        else obj.material.dispose();
                    }
                });
            }
            this.group3D = null;
            this.dimBox3D = null;
            this.clearSegmentLabels();
        },

        /** Render the selected record as a 3D reinforcement bar.
         *
         *  The geometry in record.geometry.points is the FINAL polyline – no
         *  interpolation, no smoothing, no splines.  Each consecutive pair of
         *  points is rendered as one independent straight cylinder segment so
         *  every bend is preserved exactly (90° stays 90°, 135° stays 135°).
         *
         *  Implementation:
         *    - One THREE.CylinderGeometry per segment (Pi -> Pi+1)
         *    - Small sphere at each vertex to hide tiny gaps
         *    - Red start marker at P0
         */
        render3D(record) {
            if (!this.renderer3D || !this.scene3D) return;
            this.clear3DGroup();
            const mark = Vue.markRaw;
            this.group3D = mark(new THREE.Group());
            this.scene3D.add(this.group3D);

            if (!record || !record.preview || !record.preview.points || record.preview.points.length < 2) {
                return;
            }

            const displayPoints = record.preview.points;
            const dia = Math.max(record.diameter || 8, 4);
            const radius = dia / 2;
            const tubeColor = (record.type === 'BFMA') ? 0xc26c06 : 0x2d74ff;

            // Map [x, y, z] -> (x, z, y) so 2D plan shapes lie on the XZ grid.
            const vecs = displayPoints.map(p => new THREE.Vector3(p[0], p[2] || 0, p[1] || 0));

            // ---- HTML overlay labels (one per straight segment) ----
            this.createSegmentLabels(vecs);

            // ---- DEBUG: print geometry info ----
            console.group('render3D debug');
            console.log('record type:', record.type);
            console.log('number of points:', vecs.length);
            console.log('points:');
            vecs.forEach((v, i) => console.log(`  P${i}: (${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`));
            console.log('expected cylinders:', vecs.length - 1);
            console.groupEnd();

            // Shared material for all bar segments.
            const barMat = mark(new THREE.MeshStandardMaterial({
                color: tubeColor,
                metalness: 0.35,
                roughness: 0.4
            }));

            // ---- Render each segment as a straight cylinder ----
            // CylinderGeometry is created along the Y axis, centered at origin.
            // We position it at the midpoint and rotate it to align with the
            // segment direction.
            let cylinderCount = 0;
            const _up = new THREE.Vector3(0, 1, 0); // default cylinder axis
            const _dir = new THREE.Vector3();
            const _mid = new THREE.Vector3();
            const _quat = new THREE.Quaternion();

            for (let i = 0; i < vecs.length - 1; i++) {
                const a = vecs[i];
                const b = vecs[i + 1];
                _dir.subVectors(b, a);
                const len = _dir.length();
                if (len < 1e-6) continue; // skip zero-length segments

                // Cylinder along Y, height = len, centered at origin.
                const cylGeo = mark(new THREE.CylinderGeometry(radius, radius, len, 16, 1, false));
                const cyl = mark(new THREE.Mesh(cylGeo, barMat));

                // Position at midpoint.
                _mid.addVectors(a, b).multiplyScalar(0.5);
                cyl.position.copy(_mid);

                // Rotate from +Y to the segment direction.
                _dir.normalize();
                _quat.setFromUnitVectors(_up, _dir);
                cyl.quaternion.copy(_quat);

                this.group3D.add(cyl);
                cylinderCount++;
            }

            console.log('generated cylinders:', cylinderCount,
                '(expected', vecs.length - 1, ')');

            // ---- Vertex spheres to hide gaps at bends ----
            const vGeo = mark(new THREE.SphereGeometry(radius, 12, 12));
            const vMat = mark(new THREE.MeshStandardMaterial({
                color: tubeColor,
                metalness: 0.35,
                roughness: 0.4
            }));
            for (const v of vecs) {
                const s = mark(new THREE.Mesh(vGeo, vMat));
                s.position.copy(v);
                this.group3D.add(s);
            }

            // ---- Start marker (red sphere, slightly larger) ----
            const startGeo = mark(new THREE.SphereGeometry(radius * 1.3, 16, 16));
            const startMat = mark(new THREE.MeshStandardMaterial({
                color: 0xdf3c3c,
                metalness: 0.2,
                roughness: 0.5
            }));
            const startMesh = mark(new THREE.Mesh(startGeo, startMat));
            startMesh.position.copy(vecs[0]);
            this.group3D.add(startMesh);
            
            const box = new THREE.Box3().setFromObject(this.group3D);
            this.orbit3D.fitToBounds(box);
        },

        /** Create one HTML overlay label per straight segment (P0-P1, P1-P2, ...).
         *  Labels are created ONCE when the reinforcement is loaded and reused
         *  every frame – only left/top/opacity are updated in animate3D via
         *  updateSegmentLabels(), so there is no per-frame DOM churn. */
        createSegmentLabels(vecs) {
            this.clearSegmentLabels();

            const container = document.getElementById('segment-labels');
            if (container) {
                // Ensure the container is visible if dimensions are on
                container.style.display = this.showDimension ? '' : 'none';
            }

            if (!container || !this.camera3D || !vecs || vecs.length < 2) return;

            const originalVecs = this.selectedRecord.geometry.points.map(p => new THREE.Vector3(p[0], p[2] || 0, p[1] || 0));

            const els = [];
            const mids = [];

            for (let i = 0; i < vecs.length - 1; i++) {
                const a = vecs[i];
                const b = vecs[i + 1];
                // Calculate length from original geometry
                const len = originalVecs[i].distanceTo(originalVecs[i+1]);

                const label = document.createElement('div');
                label.className = 'segment-label';
                label.textContent = fmtLength(len);
                container.appendChild(label);

                els.push(label);
                mids.push(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5));
            }

            this.segmentLabelEls = els;
            this.segmentLabelMids = mids;
        },

        /** Reposition every segment label from the projected midpoint of its
         *  segment.  Labels behind the camera or outside the viewport are
         *  hidden (opacity 0).  Called every render frame. */
        updateSegmentLabels() {
            const els = this.segmentLabelEls;
            const mids = this.segmentLabelMids;
            const container = document.getElementById('segment-labels');
            if (!container || !this.camera3D || !els.length) return;

            if (!this.showDimension) {
                container.style.display = 'none';
                return;
            }

            const rect = container.getBoundingClientRect();
            const w = rect.width;
            const h = rect.height;
            const v = new THREE.Vector3();

            for (let i = 0; i < els.length; i++) {
                const label = els[i];
                const mid = mids[i];

                v.copy(mid).project(this.camera3D);

                // Behind camera?  NDC z outside [-1, 1].
                if (v.z < -1 || v.z > 1) {
                    label.style.opacity = '0';
                    continue;
                }

                // NDC -> pixel coordinates (CSS px, centered by CSS transform).
                const x = (v.x * 0.5 + 0.5) * w;
                const y = (-v.y * 0.5 + 0.5) * h;

                // Outside viewport (with a small margin for label size)?
                if (x < -30 || x > w + 30 || y < -30 || y > h + 30) {
                    label.style.opacity = '0';
                    continue;
                }

                label.style.left = x + 'px';
                label.style.top = y + 'px';
                label.style.opacity = '1';
            }
        },

        /** Remove all segment labels from the DOM overlay. */
        clearSegmentLabels() {
            const container = document.getElementById('segment-labels');
            if (container) container.innerHTML = '';
            this.segmentLabelEls = [];
            this.segmentLabelMids = [];
        },

        /** Dispose all 3D resources (called on unmount). */
        dispose3D() {
            if (this.rafId) cancelAnimationFrame(this.rafId);
            this.rafId = null;
            if (this.orbit3D) this.orbit3D.detach();
            if (this.scene3D) {
                this.scene3D.traverse(obj => {
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) {
                        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                        else obj.material.dispose();
                    }
                });
            }
            if (this.renderer3D) {
                this.renderer3D.dispose();
                const el = this.renderer3D.domElement;
                if (el && el.parentNode) el.parentNode.removeChild(el);
            }
            this.scene3D = null;
            this.camera3D = null;
            this.renderer3D = null;
            this.group3D = null;
            this.axesHelper3D = null;
            this.dimBox3D = null;
            this.orbit3D = null;
            this.clearSegmentLabels();
        },

        /* ------------------------------------------------------------------
         * Resize
         * ---------------------------------------------------------------- */

        onResize() {
            Viewer2D.resize();
            this.onResize3D();
            Viewer2D.render();
        }
    },

    watch: {
        viewerMode(mode) {
            if (mode === '2d') {
                this.$nextTick(() => {
                    Viewer2D.resize();
                    Viewer2D.setRecord(this.selectedRecord); // This will fit the 2D view
                });
            } else {
                // Wait for v-show to make the container visible before
                // measuring its size – otherwise clientWidth/Height are 0
                // and the renderer stays at a stale/zero resolution.
                this.$nextTick(() => {
                    this.onResize3D();
                    this.render3D(this.selectedRecord); // This will auto-fit
                });
            }
        }
    },

    mounted() {
        this.loadSettings();
        this.init2D();
        this.init3D();
        this.initResizers();
        this.setupThumbnailObserver();
        window.addEventListener('resize', this.onResize);
    },

    beforeUnmount() {
        window.removeEventListener('resize', this.onResize);
        if (this.thumbnailObserver) this.thumbnailObserver.disconnect();
        this.dispose3D();
    }
});

app.mount('#app');