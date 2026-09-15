# V2.3 Smart Fix

Implementation note for Audio+ 0.7.0.

Smart Fix analyzes a short window of the current tab's original audio locally, scores practical tonal conditions, and applies a separate conservative 10-band correction layer. Automatic band gain is limited to ±3 dB. No audio leaves the device and no remote model or API is used.

The analysis result is explanatory; the persisted audio settings are only the Smart Fix enabled flag and correction curve. Re-running Smart Fix replaces the previous curve rather than stacking it.
