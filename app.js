// Global variables
let csvData = null;
let selectedColumn = null;
let geojsonData = null;

// DOM Elements
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const removeBtn = document.getElementById('removeBtn');
const columnSection = document.getElementById('columnSection');
const columnSelect = document.getElementById('columnSelect');
const previewSection = document.getElementById('previewSection');
const previewHeader = document.getElementById('previewHeader');
const previewBody = document.getElementById('previewBody');
const previewContent = document.getElementById('previewContent');
const togglePreviewBtn = document.getElementById('togglePreviewBtn');
const convertSection = document.getElementById('convertSection');
const convertBtn = document.getElementById('convertBtn');
const resultSection = document.getElementById('resultSection');
const resultMessage = document.getElementById('resultMessage');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const errorSection = document.getElementById('errorSection');
const errorMessage = document.getElementById('errorMessage');
const errorResetBtn = document.getElementById('errorResetBtn');

// Event Listeners
uploadZone.addEventListener('click', () => fileInput.click());
browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
});
fileInput.addEventListener('change', handleFileSelect);
removeBtn.addEventListener('click', resetApp);
uploadZone.addEventListener('dragover', handleDragOver);
uploadZone.addEventListener('dragleave', handleDragLeave);
uploadZone.addEventListener('drop', handleDrop);
columnSelect.addEventListener('change', handleColumnSelect);
togglePreviewBtn.addEventListener('click', togglePreview);
convertBtn.addEventListener('click', convertToGeoJSON);
downloadBtn.addEventListener('click', downloadGeoJSON);
resetBtn.addEventListener('click', resetApp);
errorResetBtn.addEventListener('click', resetApp);

// File handling functions
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        processFile(file);
    }
}

function handleDragOver(e) {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) {
        processFile(file);
    } else {
        showError('Please drop a valid CSV file');
    }
}

function processFile(file) {
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);

    // Hide upload zone, show file info
    uploadZone.style.display = 'none';
    fileInfo.style.display = 'flex';

    // Parse CSV
    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: function (results) {
            csvData = results.data;
            populateColumnSelect(results.meta.fields);
            showPreview(results.data, results.meta.fields);
        },
        error: function (error) {
            showError('Error parsing CSV: ' + error.message);
        }
    });
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function populateColumnSelect(columns) {
    columnSelect.innerHTML = '<option value="">Choose a column...</option>';
    columns.forEach(col => {
        const option = document.createElement('option');
        option.value = col;
        option.textContent = col;
        // Auto-select common geometry column names
        if (col.toLowerCase() === 'geometry' || col.toLowerCase() === 'geom' || col.toLowerCase() === 'wkb_geometry') {
            option.selected = true;
            selectedColumn = col;
        }
        columnSelect.appendChild(option);
    });

    columnSection.style.display = 'block';

    // If a column was auto-selected, show convert button
    if (selectedColumn) {
        convertSection.style.display = 'block';
    }
}

function handleColumnSelect(e) {
    selectedColumn = e.target.value;
    if (selectedColumn) {
        convertSection.style.display = 'block';
    } else {
        convertSection.style.display = 'none';
    }
}

function togglePreview() {
    const isExpanded = togglePreviewBtn.classList.contains('expanded');

    if (isExpanded) {
        togglePreviewBtn.classList.remove('expanded');
        previewContent.style.display = 'none';
    } else {
        togglePreviewBtn.classList.add('expanded');
        previewContent.style.display = 'block';
    }
}

function showPreview(data, columns) {
    // Create header
    const headerRow = document.createElement('tr');
    columns.forEach(col => {
        const th = document.createElement('th');
        th.textContent = col;
        headerRow.appendChild(th);
    });
    previewHeader.innerHTML = '';
    previewHeader.appendChild(headerRow);

    // Create body (first 5 rows)
    previewBody.innerHTML = '';
    const previewData = data.slice(0, 5);
    previewData.forEach(row => {
        const tr = document.createElement('tr');
        columns.forEach(col => {
            const td = document.createElement('td');
            const value = row[col] || '';
            // Truncate long values
            td.textContent = value.length > 50 ? value.substring(0, 50) + '...' : value;
            td.title = value; // Show full value on hover
            tr.appendChild(td);
        });
        previewBody.appendChild(tr);
    });

    previewSection.style.display = 'block';
}

// Geometry parsing functions
function parseWKBHex(wkbHex) {
    try {
        // Remove any whitespace
        wkbHex = wkbHex.trim();

        // Convert hex string to bytes
        const bytes = [];
        for (let i = 0; i < wkbHex.length; i += 2) {
            bytes.push(parseInt(wkbHex.substr(i, 2), 16));
        }

        // Parse WKB to GeoJSON
        return parseWKBBytes(bytes);
    } catch (error) {
        return null;
    }
}

function parseWKBBytes(bytes) {
    let offset = 0;

    // Read byte order (1 = little endian, 0 = big endian)
    const byteOrder = bytes[offset++];
    const littleEndian = byteOrder === 1;

    // Read geometry type
    let geomType = readUInt32(bytes, offset, littleEndian);
    offset += 4;

    // Check for EWKB flags
    // EWKB adds flags to the geometry type integer
    // 0x20000000 = SRID present
    // 0x40000000 = M present
    // 0x80000000 = Z present

    // In some implementations (PostGIS), Z and M are part of the type value itself (e.g. PointZ = 1001)
    // But standard EWKB uses high bits. Let's handle both if possible, but primarily high bits.

    const SRID_FLAG = 0x20000000;
    const M_FLAG = 0x40000000;
    const Z_FLAG = 0x80000000;

    const hasSRID = (geomType & SRID_FLAG) !== 0;
    const hasM = (geomType & M_FLAG) !== 0;
    const hasZ = (geomType & Z_FLAG) !== 0;

    // Mask out flags to get base type
    // We also need to handle ISO WKB Z/M types (e.g. 1001 for PointZ) if they occur, 
    // though usually high bits are used in hex exports.
    // For safety, let's just mask the high bits for now.
    let baseType = geomType & ~(SRID_FLAG | M_FLAG | Z_FLAG);

    // Handle ISO SQL/MM types (1000-range for Z, 2000-range for M, 3000-range for ZM)
    if (baseType >= 1000 && baseType < 2000) {
        hasZ = true;
        baseType -= 1000;
    } else if (baseType >= 2000 && baseType < 3000) {
        hasM = true;
        baseType -= 2000;
    } else if (baseType >= 3000 && baseType < 4000) {
        hasZ = true;
        hasM = true;
        baseType -= 3000;
    }

    // If SRID is present, skip 4 bytes
    if (hasSRID) {
        offset += 4;
    }

    // Parse based on geometry type
    switch (baseType) {
        case 1: // Point
            return parsePoint(bytes, offset, littleEndian, hasZ, hasM);
        case 2: // LineString
            return parseLineString(bytes, offset, littleEndian, hasZ, hasM);
        case 3: // Polygon
            return parsePolygon(bytes, offset, littleEndian, hasZ, hasM);
        case 4: // MultiPoint
            return parseMultiPoint(bytes, offset, littleEndian, hasZ, hasM);
        case 5: // MultiLineString
            return parseMultiLineString(bytes, offset, littleEndian, hasZ, hasM);
        case 6: // MultiPolygon
            return parseMultiPolygon(bytes, offset, littleEndian, hasZ, hasM);
        default:
            throw new Error('Unsupported geometry type: ' + baseType + ' (Original: ' + geomType + ')');
    }
}

function readUInt32(bytes, offset, littleEndian) {
    if (littleEndian) {
        return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
    } else {
        return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    }
}

function readDouble(bytes, offset, littleEndian) {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    for (let i = 0; i < 8; i++) {
        view.setUint8(i, bytes[offset + i]);
    }
    return view.getFloat64(0, littleEndian);
}

function parsePoint(bytes, offset, littleEndian, hasZ, hasM) {
    const x = readDouble(bytes, offset, littleEndian);
    const y = readDouble(bytes, offset + 8, littleEndian);
    let z = undefined;

    offset += 16;

    if (hasZ) {
        z = readDouble(bytes, offset, littleEndian);
        offset += 8;
    }

    if (hasM) {
        // Skip M
        offset += 8;
    }

    const coordinates = [x, y];
    if (z !== undefined) coordinates.push(z);

    return {
        type: 'Point',
        coordinates: coordinates,
        newOffset: offset // Return new offset for multi-geometries
    };
}

function parseLineString(bytes, offset, littleEndian, hasZ, hasM) {
    const numPoints = readUInt32(bytes, offset, littleEndian);
    offset += 4;
    const coordinates = [];

    for (let i = 0; i < numPoints; i++) {
        const point = parsePoint(bytes, offset, littleEndian, hasZ, hasM);
        coordinates.push(point.coordinates);
        offset = point.newOffset;
    }

    return {
        type: 'LineString',
        coordinates: coordinates,
        newOffset: offset
    };
}

function parsePolygon(bytes, offset, littleEndian, hasZ, hasM) {
    const numRings = readUInt32(bytes, offset, littleEndian);
    offset += 4;
    const coordinates = [];

    for (let i = 0; i < numRings; i++) {
        const numPoints = readUInt32(bytes, offset, littleEndian);
        offset += 4;
        const ring = [];

        for (let j = 0; j < numPoints; j++) {
            const point = parsePoint(bytes, offset, littleEndian, hasZ, hasM);
            ring.push(point.coordinates);
            offset = point.newOffset;
        }
        coordinates.push(ring);
    }

    return {
        type: 'Polygon',
        coordinates: coordinates,
        newOffset: offset
    };
}

function parseMultiPoint(bytes, offset, littleEndian, hasZ, hasM) {
    const numPoints = readUInt32(bytes, offset, littleEndian);
    offset += 4;
    const coordinates = [];

    for (let i = 0; i < numPoints; i++) {
        offset++; // Skip byte order
        // We assume sub-geometries inherit Z/M from parent or specify it. 
        // Standard WKB MultiPoint has Points.
        // Let's read the type to be safe but usually it's redundant or we just skip 4 bytes.
        // However, for MultiPoint, the sub-elements are WKB Points.

        let subType = readUInt32(bytes, offset, littleEndian);
        offset += 4;

        // Re-check flags for sub-geometry? Usually inherited or standard.
        // Let's assume standard structure: ByteOrder + Type + PointData
        // We can reuse parsePoint but we need to handle the header.
        // Actually, parsePoint expects to start at coordinates.

        // Let's just call parsePoint directly on the data part
        const point = parsePoint(bytes, offset, littleEndian, hasZ, hasM);
        coordinates.push(point.coordinates);
        offset = point.newOffset;
    }

    return {
        type: 'MultiPoint',
        coordinates: coordinates,
        newOffset: offset
    };
}

function parseMultiLineString(bytes, offset, littleEndian, hasZ, hasM) {
    const numLineStrings = readUInt32(bytes, offset, littleEndian);
    offset += 4;
    const coordinates = [];

    for (let i = 0; i < numLineStrings; i++) {
        offset++; // Skip byte order
        let subType = readUInt32(bytes, offset, littleEndian);
        offset += 4;

        const line = parseLineString(bytes, offset, littleEndian, hasZ, hasM);
        coordinates.push(line.coordinates);
        offset = line.newOffset;
    }

    return {
        type: 'MultiLineString',
        coordinates: coordinates,
        newOffset: offset
    };
}

function parseMultiPolygon(bytes, offset, littleEndian, hasZ, hasM) {
    const numPolygons = readUInt32(bytes, offset, littleEndian);
    offset += 4;
    const coordinates = [];

    for (let i = 0; i < numPolygons; i++) {
        offset++; // Skip byte order
        let subType = readUInt32(bytes, offset, littleEndian);
        offset += 4;

        const poly = parsePolygon(bytes, offset, littleEndian, hasZ, hasM);
        coordinates.push(poly.coordinates);
        offset = poly.newOffset;
    }

    return {
        type: 'MultiPolygon',
        coordinates: coordinates,
        newOffset: offset
    };
}

function parseWKT(wktString) {
    if (!wktString) return null;

    try {
        // 1. Try standard wicket.js parse first
        const wkt = new Wkt.Wkt();
        wkt.read(wktString);
        return wkt.toJson();
    } catch (error) {
        // 2. If that fails, try to handle common issues like 3D coordinates
        try {
            // Handle POINT Z / POINT M / POINT ZM manually as they are simple and common
            // Regex for POINT with optional Z/M and coordinates inside parens
            const pointMatch = wktString.match(/^POINT\s*(?:Z|M|ZM)?\s*\(\s*([-\d\.]+)\s+([-\d\.]+)(?:\s+[-\d\.]+)?(?:\s+[-\d\.]+)?\s*\)$/i);

            if (pointMatch) {
                const x = parseFloat(pointMatch[1]);
                const y = parseFloat(pointMatch[2]);
                // We ignore Z and M for now to be safe, or we could add Z if we want 3D
                // Let's stick to 2D for maximum compatibility unless we confirm 3D support is needed/working
                return {
                    type: 'Point',
                    coordinates: [x, y]
                };
            }

            // For other geometries, try to strip Z/M/ZM and extra coordinates
            // This is a naive approach: remove Z/M/ZM keywords and try to keep only first 2 coords per point
            // A better approach for complex WKT is harder with regex. 
            // Let's try just removing the 'Z', 'M', 'ZM' keywords first.
            let cleanWkt = wktString.replace(/\s+(?:Z|M|ZM)\s+\(/i, ' (');

            // If it was just the keyword causing issues, retry
            if (cleanWkt !== wktString) {
                const wkt2 = new Wkt.Wkt();
                wkt2.read(cleanWkt);
                return wkt2.toJson();
            }

            return null;
        } catch (e) {
            console.error("WKT Parse Error:", e);
            return null;
        }
    }
}

function parseGeometry(geomString) {
    if (!geomString || geomString.trim() === '') {
        return null;
    }

    geomString = geomString.trim();

    // Try WKB hex first (most common from pgAdmin)
    if (/^[0-9A-Fa-f]+$/.test(geomString)) {
        const geom = parseWKBHex(geomString);
        if (geom) return geom;
    }

    // Fallback to WKT
    return parseWKT(geomString);
}

// Conversion function
function convertToGeoJSON() {
    if (!csvData || !selectedColumn) {
        showError('Please select a file and geometry column');
        return;
    }

    convertBtn.classList.add('loading');
    convertBtn.disabled = true;

    // Small delay to show loading state
    setTimeout(() => {
        try {
            const features = [];
            let skippedCount = 0;

            csvData.forEach((row, index) => {
                const geomString = row[selectedColumn];
                const geometry = parseGeometry(geomString);

                if (geometry) {
                    // Create properties object (all columns except geometry)
                    const properties = {};
                    Object.keys(row).forEach(key => {
                        if (key !== selectedColumn) {
                            properties[key] = row[key];
                        }
                    });

                    features.push({
                        type: 'Feature',
                        geometry: geometry,
                        properties: properties
                    });
                } else {
                    skippedCount++;
                }
            });

            geojsonData = {
                type: 'FeatureCollection',
                features: features
            };

            // Show result
            let message = `Successfully converted ${features.length} features to GeoJSON.`;
            if (skippedCount > 0) {
                message += ` (${skippedCount} rows skipped due to invalid geometry)`;
            }

            resultMessage.textContent = message;
            resultSection.style.display = 'block';
            convertSection.style.display = 'none';

            convertBtn.classList.remove('loading');
            convertBtn.disabled = false;
        } catch (error) {
            convertBtn.classList.remove('loading');
            convertBtn.disabled = false;
            showError('Conversion failed: ' + error.message);
        }
    }, 300);
}

function downloadGeoJSON() {
    if (!geojsonData) return;

    const jsonString = JSON.stringify(geojsonData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.textContent.replace('.csv', '.geojson');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function showError(message) {
    errorMessage.textContent = message;
    errorSection.style.display = 'block';

    // Hide other sections
    columnSection.style.display = 'none';
    previewSection.style.display = 'none';
    convertSection.style.display = 'none';
    resultSection.style.display = 'none';
}

function resetApp() {
    // Reset all state
    csvData = null;
    selectedColumn = null;
    geojsonData = null;
    fileInput.value = '';

    // Reset UI
    uploadZone.style.display = 'block';
    fileInfo.style.display = 'none';
    columnSection.style.display = 'none';
    previewSection.style.display = 'none';
    convertSection.style.display = 'none';
    resultSection.style.display = 'none';
    errorSection.style.display = 'none';
}
