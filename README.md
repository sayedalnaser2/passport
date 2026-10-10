# Bahrain Passport Reader

Batch-reads Bahraini passport data pages (JPG/PNG/PDF) into an editable sheet with Excel / CSV / clipboard export. Fully client-side.
Serve with `python3 -m http.server` and open `index.html`.

## How it reads a passport
1. **MRZ** (the two `P<BHR…` lines): OCR on several crops/filters, orientation + tilt search, character voting, then
   ICAO check-digit verification. If a check fails, the smallest character edit (O/0, I/1, B/8, S/5…) that satisfies it is applied.
2. **Printed page (visual zone)**: full-page OCR, labelled fields located by fuzzy label match + geometry
   (passport no., names, nationality, DOB, sex, place of birth, issue/expiry date, authority, personal/CPR no.).
3. **Reconcile**: MRZ wins where check-digit-verified; printed values fill what the MRZ lacks (place of birth, issue date, authority)
   and steer repairs; real disagreements are flagged (✔ verified, ≈ printed page differs, ⚠ needs checking).
4. **Debug**: tick "debug log" and click a row number to see every OCR pass, cells, parsed fields and repairs (`__passportRows` in the console).

Tests: `node tests/mrz.test.mjs`; `python3 tests/gen_samples.py` makes synthetic passport pages (clean/tilted/upside-down/noisy) to try the UI.
Limits: OCR is English only (Arabic text is ignored); printed fields without check digits (place of birth, authority, names) can't be verified.
