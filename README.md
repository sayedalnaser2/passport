# Bahrain Passport Reader

Batch-reads the MRZ (`P<BHR…` lines) from passport scans (JPG/PNG/PDF), verifies ICAO check digits, and shows an editable sheet
with Excel / CSV / clipboard export. Fully client-side. Serve with `python3 -m http.server` and open `index.html`.
OCR uses tesseract.js loaded from a CDN on first use. Parser: `mrz.js`.
