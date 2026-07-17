#include QMK_KEYBOARD_H

enum layers {
    _BASE,
    _FN,
};

const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {
    [_BASE] = LAYOUT_ortho_4x4(
        KC_7,    KC_8,    KC_9,    KC_SLSH,
        KC_4,    KC_5,    KC_6,    KC_ASTR,
        KC_1,    KC_2,    KC_3,    KC_MINS,
        KC_0,    KC_DOT,  MO(_FN), KC_ENT
    ),
    [_FN] = LAYOUT_ortho_4x4(
        QK_BOOT, KC_NO,   KC_NO,   KC_VOLU,
        KC_NO,   KC_NO,   KC_NO,   KC_VOLD,
        KC_NO,   KC_NO,   KC_NO,   KC_MUTE,
        KC_TRNS, KC_NO,   KC_TRNS, KC_NO
    ),
};
