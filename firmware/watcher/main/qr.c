#include "qr.h"
#include <string.h>
#include "qrcode.h"
#include "esp_log.h"

// Version 10 = 57x57 modules, plenty for a ~90-char claim URL at ECC medium.
#define QR_MAX 57

static uint8_t s_grid[QR_MAX][QR_MAX];
static int s_size = 0;
static char s_url[160] = "";

static void capture(esp_qrcode_handle_t qrcode) {
    int n = esp_qrcode_get_size(qrcode);
    if (n > QR_MAX) n = QR_MAX;
    s_size = n;
    for (int y = 0; y < n; y++)
        for (int x = 0; x < n; x++)
            s_grid[y][x] = esp_qrcode_get_module(qrcode, x, y) ? 1 : 0;
}

int qr_set(const char *url) {
    if (!url || !url[0]) { qr_clear(); return 0; }
    if (!strcmp(url, s_url) && s_size) return s_size; // already encoded
    snprintf(s_url, sizeof(s_url), "%s", url);
    s_size = 0;
    esp_qrcode_config_t cfg = {
        .display_func = capture,
        .max_qrcode_version = 10,
        .qrcode_ecc_level = ESP_QRCODE_ECC_MED,
    };
    if (esp_qrcode_generate(&cfg, s_url) != ESP_OK) {
        ESP_LOGE("qr", "encode failed for %s", s_url);
        s_url[0] = 0;
        return 0;
    }
    return s_size;
}

int qr_size(void) { return s_size; }
bool qr_module(int x, int y) { return s_size && x >= 0 && y >= 0 && x < s_size && y < s_size && s_grid[y][x]; }
void qr_clear(void) { s_size = 0; s_url[0] = 0; }
