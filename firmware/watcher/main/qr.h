#pragma once
// QR encode-and-cache for the claim URL. Generate once per URL, draw many.
#include <stdbool.h>

// Encode url into the cached grid. Returns module count per side (0 on failure).
int qr_set(const char *url);
int qr_size(void);                  // current grid size (modules per side), 0 if none
bool qr_module(int x, int y);       // true = dark module
void qr_clear(void);
