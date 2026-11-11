#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use sound_drop_core_dsp::modem::ModemMode;
use sound_drop_core_dsp::{encode_to_pcm, analyze_spectrum};

#[tauri::command]
fn synthesize_chirp_pcm(session_id: u8, mode_name: String) -> Vec<f32> {
    let mode = match mode_name.as_str() {
        "ultrasonic" => ModemMode::Ultrasonic,
        "whisper" => ModemMode::Whisper,
        _ => ModemMode::Audible,
    };
    let payload = [0xAA, 0x55, session_id, 0x01];
    encode_to_pcm(&payload, mode, 0.85)
}

#[tauri::command]
fn process_audio_buffer(samples: Vec<f32>) -> (Option<u8>, f64, f64) {
    analyze_spectrum(&samples, ModemMode::Audible)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            synthesize_chirp_pcm,
            process_audio_buffer
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sound Drop native desktop application");
}
