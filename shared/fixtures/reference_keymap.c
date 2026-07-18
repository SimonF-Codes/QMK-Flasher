#include QMK_KEYBOARD_H
#include "version.h"
#define MOON_LED_LEVEL LED_LEVEL
#ifndef ZSA_SAFE_RANGE
#define ZSA_SAFE_RANGE SAFE_RANGE
#endif

enum custom_keycodes {
  RGB_SLD = ZSA_SAFE_RANGE,
  HSV_0_245_245,
  HSV_82_251_228,
  HSV_163_255_203,
  HSV_195_255_84,
  ST_MACRO_0,
  ST_MACRO_1,
  ST_MACRO_2,
  ST_MACRO_3,
  ST_MACRO_4,
  ST_MACRO_5,
  ST_MACRO_6,
};



enum tap_dance_codes {
  DANCE_0,
  DANCE_1,
};

#define DUAL_FUNC_0 LT(10, KC_F20)
#define DUAL_FUNC_1 LT(2, KC_0)
#define DUAL_FUNC_2 LT(8, KC_Z)
#define DUAL_FUNC_3 LT(15, KC_R)
#define DUAL_FUNC_4 LT(5, KC_S)
#define DUAL_FUNC_5 LT(13, KC_L)

const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {
  [0] = LAYOUT_moonlander(
    KC_ESCAPE,      KC_1,           KC_2,           KC_3,           KC_4,           KC_5,           TO(3),                                          TO(4),          KC_6,           KC_7,           KC_8,           KC_9,           KC_0,           KC_DELETE,      
    KC_EQUAL,       KC_Q,           KC_W,           KC_E,           KC_R,           KC_T,           TG(1),                                          TG(2),          KC_Y,           KC_U,           KC_I,           KC_O,           KC_P,           KC_QUOTE,       
    KC_MINUS,       KC_A,           KC_S,           KC_D,           KC_F,           KC_G,           TD(DANCE_0),                                                                    QK_LOCK,         KC_H,           KC_J,           KC_K,           KC_L,           LT(3, KC_SCLN), MT(MOD_RSFT, KC_ENTER),
    KC_LEFT_SHIFT,  KC_Z,           KC_X,           KC_C,           KC_V,           KC_B,                                           KC_N,           KC_M,           KC_COMMA,       KC_DOT,         DUAL_FUNC_0,    KC_TAB,         
    MT(MOD_LCTL, KC_GRAVE),KC_CAPS,        KC_LEFT_GUI,    MT(MOD_RCTL, KC_BSLS),LT(1, KC_SLASH),MT(MOD_LALT, KC_APPLICATION),                                                                                                MT(MOD_RCTL, KC_ESCAPE),KC_LBRC,        KC_RBRC,        DUAL_FUNC_1,    DUAL_FUNC_2,    DUAL_FUNC_3,    
    KC_SPACE,       KC_TAB,         TD(DANCE_1),                    KC_LEFT_ALT,    KC_BSPC,        KC_ENTER
  ),
  [1] = LAYOUT_moonlander(
    KC_ESCAPE,      KC_F1,          KC_F2,          KC_F3,          KC_F4,          KC_F5,          TO(3),                                          TO(4),          KC_F6,          KC_F7,          KC_F8,          KC_F9,          KC_F10,         KC_F11,         
    KC_TRANSPARENT, KC_EXLM,        KC_AT,          KC_LCBR,        KC_RCBR,        KC_PIPE,        KC_TRANSPARENT,                                 TO(2),          KC_UP,          KC_7,           KC_8,           KC_9,           KC_ASTR,        KC_F12,         
    KC_TRANSPARENT, KC_HASH,        KC_DLR,         KC_LPRN,        KC_RPRN,        KC_GRAVE,       KC_TRANSPARENT,                                                                 KC_TRANSPARENT, KC_DOWN,        KC_4,           KC_5,           KC_6,           KC_KP_PLUS,     KC_TRANSPARENT, 
    KC_TRANSPARENT, KC_PERC,        KC_CIRC,        KC_LBRC,        KC_RBRC,        KC_TILD,                                        KC_AMPR,        KC_1,           KC_2,           KC_3,           KC_BSLS,        KC_TRANSPARENT, 
    KC_TRANSPARENT, KC_COMMA,       HSV_0_245_245,  KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT,                                                                                                 KC_TRANSPARENT, KC_TRANSPARENT, KC_0,           KC_DOT,         KC_EQUAL,       KC_TRANSPARENT, 
    KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT,                 KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT
  ),
  [2] = LAYOUT_moonlander(
    AU_TOGG,        KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, TO(3),                                          TO(4),          KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, QK_BOOT,        
    MU_TOGG,        KC_TRANSPARENT, KC_TRANSPARENT, KC_MS_UP,       KC_TRANSPARENT, KC_TRANSPARENT, TO(1),                                          KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, 
    MU_NEXT,        KC_TRANSPARENT, KC_MS_LEFT,     KC_MS_DOWN,     KC_MS_RIGHT,    KC_TRANSPARENT, KC_TRANSPARENT,                                                                 KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_MEDIA_PLAY_PAUSE,
    KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT,                                 KC_TRANSPARENT, KC_TRANSPARENT, KC_MEDIA_PREV_TRACK,KC_MEDIA_NEXT_TRACK,KC_TRANSPARENT, KC_TRANSPARENT, 
    KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT,                                                                                                 KC_TRANSPARENT, KC_AUDIO_VOL_UP,KC_AUDIO_VOL_DOWN,KC_AUDIO_MUTE,  KC_TRANSPARENT, KC_TRANSPARENT, 
    KC_MS_BTN1,     KC_MS_BTN2,     KC_TRANSPARENT,                 KC_TRANSPARENT, KC_TRANSPARENT, KC_WWW_BACK
  ),
  [3] = LAYOUT_moonlander(
    KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, TO(0),                                          TO(4),          KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, 
    KC_TRANSPARENT, KC_TRANSPARENT, ST_MACRO_0,     KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, TO(1),                                          TO(2),          KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, 
    KC_TRANSPARENT, KC_TRANSPARENT, ST_MACRO_1,     KC_TRANSPARENT, ST_MACRO_2,     ST_MACRO_3,     KC_TRANSPARENT,                                                                 KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, 
    KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, ST_MACRO_4,     ST_MACRO_5,     KC_TRANSPARENT,                                 KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, 
    KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT,                                                                                                 KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, 
    KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT,                 KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT
  ),
  [4] = LAYOUT_moonlander(
    KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, TO(3),                                          TO(0),          ST_MACRO_6,     KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_AUDIO_VOL_UP,
    KC_TRANSPARENT, RGB_SPI,        RGB_SAI,        RGB_VAI,        RGB_HUI,        RGB_SLD,        TO(1),                                          TO(2),          AU_TOGG,        KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_AUDIO_VOL_DOWN,
    KC_TRANSPARENT, RGB_SPD,        RGB_SAD,        RGB_VAD,        RGB_HUD,        TOGGLE_LAYER_COLOR,KC_TRANSPARENT,                                                                 KC_TRANSPARENT, MU_TOGG,        DUAL_FUNC_4,    KC_MEDIA_PLAY_PAUSE,DUAL_FUNC_5,    KC_MS_BTN3,     KC_AUDIO_MUTE,  
    KC_TRANSPARENT, RGB_MODE_FORWARD,HSV_82_251_228, HSV_163_255_203,HSV_195_255_84, RGB_TOG,                                        MU_NEXT,        KC_TRANSPARENT, KC_MS_WH_UP,    KC_MS_BTN1,     KC_MS_UP,       KC_MS_BTN2,     
    KC_TRANSPARENT, QK_BOOT,        AS_OFF,         AS_TOGG,        AS_ON,          KC_TRANSPARENT,                                                                                                 KC_TRANSPARENT, KC_TRANSPARENT, KC_MS_WH_DOWN,  KC_MS_LEFT,     KC_MS_DOWN,     KC_MS_RIGHT,    
    KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT,                 KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT
  ),
  [5] = LAYOUT_moonlander(
    KC_DELETE,      KC_0,           KC_9,           KC_8,           KC_7,           KC_6,           KC_TRANSPARENT,                                 KC_TRANSPARENT, KC_5,           KC_4,           KC_3,           KC_2,           KC_1,           KC_ESCAPE,      
    KC_QUOTE,       KC_P,           KC_O,           KC_I,           KC_U,           KC_Y,           KC_TRANSPARENT,                                 KC_TRANSPARENT, KC_T,           KC_R,           KC_E,           KC_W,           KC_Q,           KC_EQUAL,       
    KC_ENTER,       KC_SCLN,        KC_L,           KC_K,           KC_J,           KC_H,           KC_TRANSPARENT,                                                                 KC_TRANSPARENT, KC_G,           KC_F,           KC_D,           KC_S,           KC_A,           KC_MINUS,       
    KC_BSPC,        KC_UP,          KC_DOT,         KC_COMMA,       KC_M,           KC_N,                                           KC_B,           KC_V,           KC_C,           KC_X,           KC_Z,           KC_LEFT_SHIFT,  
    KC_LEFT,        KC_DOWN,        KC_RIGHT,       KC_LBRC,        KC_RBRC,        MT(MOD_LCTL, KC_ESCAPE),                                                                                                MT(MOD_RALT, KC_APPLICATION),KC_BSLS,        KC_SLASH,       KC_LEFT_GUI,    CW_TOGG,        KC_GRAVE,       
    KC_ENTER,       KC_TAB,         MT(MOD_LALT, KC_ENTER),                KC_LEFT_GUI,    KC_BSPC,        KC_SPACE
  ),
  [6] = LAYOUT_moonlander(
    KC_ESCAPE,      KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT,                                 KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, 
    KC_TRANSPARENT, KC_TRANSPARENT, KC_W,           KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT,                                 KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, 
    KC_TAB,         KC_A,           KC_S,           KC_D,           KC_TRANSPARENT, KC_TRANSPARENT, AS_TOGG,                                                                        KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, 
    KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT,                                 KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, 
    KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT,                                                                                                 KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT, 
    KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT,                 KC_TRANSPARENT, KC_TRANSPARENT, KC_TRANSPARENT
  ),
};


const uint16_t PROGMEM combo0[] = { TG(2), TO(4), COMBO_END};
const uint16_t PROGMEM combo1[] = { TG(1), TO(3), COMBO_END};

combo_t key_combos[COMBO_COUNT] = {
    COMBO(combo0, TG(5)),
    COMBO(combo1, TG(5)),
};



extern rgb_config_t rgb_matrix_config;

RGB hsv_to_rgb_with_value(HSV hsv) {
  RGB rgb = hsv_to_rgb( hsv );
  float f = (float)rgb_matrix_config.hsv.v / UINT8_MAX;
  return (RGB){ f * rgb.r, f * rgb.g, f * rgb.b };
}

void keyboard_post_init_user(void) {
  rgb_matrix_enable();
}

const uint8_t PROGMEM ledmap[][RGB_MATRIX_LED_COUNT][3] = {
    [0] = { {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {0,231,237}, {83,239,235}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {125,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {125,255,107}, {125,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {125,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {125,241,255}, {175,253,237}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107}, {192,255,107} },

    [1] = { {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {0,231,237}, {192,255,107}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {125,241,255}, {175,255,217}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235}, {83,239,235} },

    [2] = { {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {0,231,237}, {83,239,235}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {125,241,255}, {175,255,217}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237}, {175,253,237} },

    [3] = { {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {192,255,107}, {83,239,235}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {125,241,255}, {175,255,217}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237}, {0,231,237} },

    [4] = { {125,241,255}, {125,241,255}, {125,241,255}, {125,241,255}, {125,241,255}, {125,241,255}, {83,239,235}, {0,231,237}, {175,255,217}, {216,229,111}, {125,241,255}, {83,239,235}, {0,231,237}, {82,251,228}, {0,231,237}, {125,241,255}, {83,239,235}, {0,231,237}, {163,255,203}, {40,255,226}, {125,241,255}, {83,239,235}, {0,231,237}, {195,252,174}, {83,239,235}, {125,241,255}, {125,241,255}, {125,241,255}, {125,241,255}, {0,231,237}, {83,239,235}, {125,241,255}, {125,241,255}, {125,241,255}, {125,241,255}, {125,241,255}, {83,239,235}, {40,255,226}, {0,231,237}, {94,243,255}, {94,243,255}, {125,241,255}, {125,241,255}, {94,243,255}, {94,243,255}, {94,243,255}, {125,241,255}, {125,241,255}, {175,255,217}, {94,243,255}, {94,243,255}, {125,241,255}, {125,241,255}, {83,239,235}, {40,255,226}, {40,255,226}, {125,241,255}, {125,241,255}, {0,231,237}, {125,241,255}, {125,241,255}, {40,255,226}, {125,241,255}, {125,241,255}, {125,241,255}, {192,255,107}, {175,255,217}, {125,241,255}, {125,241,255}, {125,241,255}, {125,241,255}, {125,241,255} },

    [5] = { {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192}, {216,236,192} },

    [6] = { {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {94,243,255}, {182,176,198}, {182,176,198}, {182,176,198}, {94,243,255}, {94,243,255}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {94,243,255}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198}, {182,176,198} },

};

void set_layer_color(int layer) {
  for (int i = 0; i < RGB_MATRIX_LED_COUNT; i++) {
    HSV hsv = {
      .h = pgm_read_byte(&ledmap[layer][i][0]),
      .s = pgm_read_byte(&ledmap[layer][i][1]),
      .v = pgm_read_byte(&ledmap[layer][i][2]),
    };
    if (!hsv.h && !hsv.s && !hsv.v) {
        rgb_matrix_set_color( i, 0, 0, 0 );
    } else {
        RGB rgb = hsv_to_rgb_with_value(hsv);
        rgb_matrix_set_color(i, rgb.r, rgb.g, rgb.b);
    }
  }
}

bool rgb_matrix_indicators_user(void) {
  if (rawhid_state.rgb_control) {
      return false;
  }
  if (!keyboard_config.disable_layer_led) { 
    switch (biton32(layer_state)) {
      case 0:
        set_layer_color(0);
        break;
      case 1:
        set_layer_color(1);
        break;
      case 2:
        set_layer_color(2);
        break;
      case 3:
        set_layer_color(3);
        break;
      case 4:
        set_layer_color(4);
        break;
      case 5:
        set_layer_color(5);
        break;
      case 6:
        set_layer_color(6);
        break;
     default:
        if (rgb_matrix_get_flags() == LED_FLAG_NONE) {
          rgb_matrix_set_color_all(0, 0, 0);
        }
    }
  } else {
    if (rgb_matrix_get_flags() == LED_FLAG_NONE) {
      rgb_matrix_set_color_all(0, 0, 0);
    }
  }

  return true;
}


typedef struct {
    bool is_press_action;
    uint8_t step;
} tap;

enum {
    SINGLE_TAP = 1,      
    SINGLE_HOLD,         
    DOUBLE_TAP,          
    DOUBLE_HOLD,         
    DOUBLE_SINGLE_TAP,   
    MORE_TAPS            
};

static tap dance_state[2];

uint8_t dance_step(tap_dance_state_t *state);

uint8_t dance_step(tap_dance_state_t *state) {
    if (state->count == 1) {
        if (state->interrupted || !state->pressed) return SINGLE_TAP;
        else return SINGLE_HOLD;
    } else if (state->count == 2) {
        if (state->interrupted) return DOUBLE_SINGLE_TAP;
        else if (state->pressed) return DOUBLE_HOLD;
        else return DOUBLE_TAP;
    }
    return MORE_TAPS;
}


void on_dance_0(tap_dance_state_t *state, void *user_data);
void dance_0_finished(tap_dance_state_t *state, void *user_data);
void dance_0_reset(tap_dance_state_t *state, void *user_data);

void on_dance_0(tap_dance_state_t *state, void *user_data) {
    if(state->count == 3) {
        tap_code16(KC_BSPC);
        tap_code16(KC_BSPC);
        tap_code16(KC_BSPC);
    }
    if(state->count > 3) {
        tap_code16(KC_BSPC);
    }
}

void dance_0_finished(tap_dance_state_t *state, void *user_data) {
    dance_state[0].step = dance_step(state);
    switch (dance_state[0].step) {
        case SINGLE_TAP: register_code16(KC_BSPC); break;
        case DOUBLE_TAP: register_code16(KC_CALCULATOR); break;
        case DOUBLE_SINGLE_TAP: tap_code16(KC_BSPC); register_code16(KC_BSPC);
    }
}

void dance_0_reset(tap_dance_state_t *state, void *user_data) {
    wait_ms(10);
    switch (dance_state[0].step) {
        case SINGLE_TAP: unregister_code16(KC_BSPC); break;
        case DOUBLE_TAP: unregister_code16(KC_CALCULATOR); break;
        case DOUBLE_SINGLE_TAP: unregister_code16(KC_BSPC); break;
    }
    dance_state[0].step = 0;
}
void on_dance_1(tap_dance_state_t *state, void *user_data);
void dance_1_finished(tap_dance_state_t *state, void *user_data);
void dance_1_reset(tap_dance_state_t *state, void *user_data);

void on_dance_1(tap_dance_state_t *state, void *user_data) {
    if(state->count == 3) {
        tap_code16(KC_LEFT_GUI);
        tap_code16(KC_LEFT_GUI);
        tap_code16(KC_LEFT_GUI);
    }
    if(state->count > 3) {
        tap_code16(KC_LEFT_GUI);
    }
}

void dance_1_finished(tap_dance_state_t *state, void *user_data) {
    dance_state[1].step = dance_step(state);
    switch (dance_state[1].step) {
        case SINGLE_TAP: register_code16(KC_LEFT_GUI); break;
        case SINGLE_HOLD: register_code16(KC_LEFT_GUI); break;
        case DOUBLE_TAP: register_code16(KC_LEFT_GUI); register_code16(KC_LEFT_GUI); break;
        case DOUBLE_HOLD: register_code16(KC_LEFT_CTRL); break;
        case DOUBLE_SINGLE_TAP: tap_code16(KC_LEFT_GUI); register_code16(KC_LEFT_GUI);
    }
}

void dance_1_reset(tap_dance_state_t *state, void *user_data) {
    wait_ms(10);
    switch (dance_state[1].step) {
        case SINGLE_TAP: unregister_code16(KC_LEFT_GUI); break;
        case SINGLE_HOLD: unregister_code16(KC_LEFT_GUI); break;
        case DOUBLE_TAP: unregister_code16(KC_LEFT_GUI); break;
        case DOUBLE_HOLD: unregister_code16(KC_LEFT_CTRL); break;
        case DOUBLE_SINGLE_TAP: unregister_code16(KC_LEFT_GUI); break;
    }
    dance_state[1].step = 0;
}

tap_dance_action_t tap_dance_actions[] = {
        [DANCE_0] = ACTION_TAP_DANCE_FN_ADVANCED(on_dance_0, dance_0_finished, dance_0_reset),
        [DANCE_1] = ACTION_TAP_DANCE_FN_ADVANCED(on_dance_1, dance_1_finished, dance_1_reset),
};

bool process_record_user(uint16_t keycode, keyrecord_t *record) {
  switch (keycode) {
  case QK_MODS ... QK_MODS_MAX:
    // Mouse and consumer keys (volume, media) with modifiers work inconsistently across operating systems,
    // this makes sure that modifiers are always applied to the key that was pressed.
    if (IS_MOUSE_KEYCODE(QK_MODS_GET_BASIC_KEYCODE(keycode)) || IS_CONSUMER_KEYCODE(QK_MODS_GET_BASIC_KEYCODE(keycode))) {
      if (record->event.pressed) {
        add_mods(QK_MODS_GET_MODS(keycode));
        send_keyboard_report();
        wait_ms(2);
        register_code(QK_MODS_GET_BASIC_KEYCODE(keycode));
        return false;
      } else {
        wait_ms(2);
        del_mods(QK_MODS_GET_MODS(keycode));
      }
    }
    break;
    case ST_MACRO_0:
    if (record->event.pressed) {
      SEND_STRING(SS_TAP(X_P)SS_DELAY(100)  SS_TAP(X_U)SS_DELAY(100)  SS_TAP(X_S)SS_DELAY(100)  SS_TAP(X_H));
    }
    break;
    case ST_MACRO_1:
    if (record->event.pressed) {
      SEND_STRING(SS_TAP(X_P)SS_DELAY(100)  SS_TAP(X_U)SS_DELAY(100)  SS_TAP(X_L)SS_DELAY(100)  SS_TAP(X_L));
    }
    break;
    case ST_MACRO_2:
    if (record->event.pressed) {
      SEND_STRING(SS_TAP(X_F)SS_DELAY(100)  SS_TAP(X_E)SS_DELAY(100)  SS_TAP(X_T)SS_DELAY(100)  SS_TAP(X_C)SS_DELAY(100)  SS_TAP(X_H));
    }
    break;
    case ST_MACRO_3:
    if (record->event.pressed) {
      SEND_STRING(SS_TAP(X_G)SS_DELAY(100)  SS_TAP(X_I)SS_DELAY(100)  SS_TAP(X_T)SS_DELAY(100)  SS_TAP(X_SPACE));
    }
    break;
    case ST_MACRO_4:
    if (record->event.pressed) {
      SEND_STRING(SS_TAP(X_C)SS_DELAY(100)  SS_TAP(X_D)SS_DELAY(100)  SS_TAP(X_SPACE));
    }
    break;
    case ST_MACRO_5:
    if (record->event.pressed) {
      SEND_STRING(SS_TAP(X_V)SS_DELAY(100)  SS_TAP(X_I)SS_DELAY(100)  SS_TAP(X_M)SS_DELAY(100)  SS_TAP(X_SPACE));
    }
    break;
    case ST_MACRO_6:
    if (record->event.pressed) {
      SEND_STRING(SS_LCTL(SS_LSFT(SS_TAP(X_5))));
    }
    break;

    case DUAL_FUNC_0:
      if (record->tap.count > 0) {
        if (record->event.pressed) {
          register_code16(KC_UP);
        } else {
          unregister_code16(KC_UP);
        }
      } else {
        if (record->event.pressed) {
          register_code16(KC_UP);
        } else {
          unregister_code16(KC_UP);
        }  
      }  
      return false;
    case DUAL_FUNC_1:
      if (record->tap.count > 0) {
        if (record->event.pressed) {
          register_code16(KC_LEFT);
        } else {
          unregister_code16(KC_LEFT);
        }
      } else {
        if (record->event.pressed) {
          register_code16(KC_LEFT);
        } else {
          unregister_code16(KC_LEFT);
        }  
      }  
      return false;
    case DUAL_FUNC_2:
      if (record->tap.count > 0) {
        if (record->event.pressed) {
          register_code16(KC_DOWN);
        } else {
          unregister_code16(KC_DOWN);
        }
      } else {
        if (record->event.pressed) {
          register_code16(KC_DOWN);
        } else {
          unregister_code16(KC_DOWN);
        }  
      }  
      return false;
    case DUAL_FUNC_3:
      if (record->tap.count > 0) {
        if (record->event.pressed) {
          register_code16(KC_RIGHT);
        } else {
          unregister_code16(KC_RIGHT);
        }
      } else {
        if (record->event.pressed) {
          register_code16(KC_RIGHT);
        } else {
          unregister_code16(KC_RIGHT);
        }  
      }  
      return false;
    case DUAL_FUNC_4:
      if (record->tap.count > 0) {
        if (record->event.pressed) {
          register_code16(KC_MEDIA_PREV_TRACK);
        } else {
          unregister_code16(KC_MEDIA_PREV_TRACK);
        }
      } else {
        if (record->event.pressed) {
          register_code16(KC_MEDIA_REWIND);
        } else {
          unregister_code16(KC_MEDIA_REWIND);
        }  
      }  
      return false;
    case DUAL_FUNC_5:
      if (record->tap.count > 0) {
        if (record->event.pressed) {
          register_code16(KC_MEDIA_NEXT_TRACK);
        } else {
          unregister_code16(KC_MEDIA_NEXT_TRACK);
        }
      } else {
        if (record->event.pressed) {
          register_code16(KC_MEDIA_FAST_FORWARD);
        } else {
          unregister_code16(KC_MEDIA_FAST_FORWARD);
        }  
      }  
      return false;
    case RGB_SLD:
        if (rawhid_state.rgb_control) {
            return false;
        }
        if (record->event.pressed) {
            rgblight_mode(1);
        }
        return false;
    case HSV_0_245_245:
        if (rawhid_state.rgb_control) {
            return false;
        }
        if (record->event.pressed) {
            rgblight_mode(1);
            rgblight_sethsv(0,245,245);
        }
        return false;
    case HSV_82_251_228:
        if (rawhid_state.rgb_control) {
            return false;
        }
        if (record->event.pressed) {
            rgblight_mode(1);
            rgblight_sethsv(82,251,228);
        }
        return false;
    case HSV_163_255_203:
        if (rawhid_state.rgb_control) {
            return false;
        }
        if (record->event.pressed) {
            rgblight_mode(1);
            rgblight_sethsv(163,255,203);
        }
        return false;
    case HSV_195_255_84:
        if (rawhid_state.rgb_control) {
            return false;
        }
        if (record->event.pressed) {
            rgblight_mode(1);
            rgblight_sethsv(195,255,84);
        }
        return false;
  }
  return true;
}

