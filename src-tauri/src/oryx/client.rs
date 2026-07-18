//! Oryx HTTP client: the GraphQL layout query (the shape that produced
//! `shared/fixtures/oryx_rddD7_QzpBEp.json`) and the source-zip download used
//! by the seed-time cross-check. Blocking reqwest (rustls); all transport
//! failures map to [`AppError::OryxUnreachable`].

use std::io::Read;
use std::time::Duration;

use crate::error::AppError;

pub const GRAPHQL_URL: &str = "https://oryx.zsa.io/graphql";
pub const SOURCE_URL_BASE: &str = "https://oryx.zsa.io/source";

/// The full-layout query: revision metadata + every layer's key objects +
/// combos. `keys` is a JSON scalar on Oryx's side.
const LAYOUT_QUERY: &str = "query getLayout($hashId: String!, $revisionId: String!, $geometry: String) { layout(hashId: $hashId, geometry: $geometry, revisionId: $revisionId) { revision { hashId qmkVersion layers { position title color keys } combos { name keyIndices layerIdx trigger } } } }";

fn unreachable_err(e: impl std::fmt::Display) -> AppError {
    AppError::OryxUnreachable(e.to_string())
}

fn client() -> Result<reqwest::blocking::Client, AppError> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(unreachable_err)
}

/// Fetch the latest revision of `layout_id` as the raw GraphQL response body
/// (input to [`super::seed::layout_from_snapshot`]).
pub fn fetch_layout_snapshot(layout_id: &str) -> Result<String, AppError> {
    let body = serde_json::json!({
        "query": LAYOUT_QUERY,
        "variables": {
            "hashId": layout_id,
            "revisionId": "latest",
            "geometry": "moonlander",
        },
    });
    let resp = client()?
        .post(GRAPHQL_URL)
        .json(&body)
        .send()
        .map_err(unreachable_err)?
        .error_for_status()
        .map_err(unreachable_err)?;
    let text = resp.text().map_err(unreachable_err)?;
    // GraphQL transports errors in a 200 body; surface them.
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
        if let Some(errors) = v.get("errors").and_then(|e| e.as_array()) {
            if !errors.is_empty() {
                return Err(unreachable_err(format!(
                    "GraphQL error: {}",
                    serde_json::to_string(errors).unwrap_or_default()
                )));
            }
        }
    }
    Ok(text)
}

/// Download `https://oryx.zsa.io/source/<revision_hash>` (a zip).
pub fn download_source_zip(revision_hash: &str) -> Result<Vec<u8>, AppError> {
    let url = format!("{SOURCE_URL_BASE}/{revision_hash}");
    let resp = client()?
        .get(&url)
        .send()
        .map_err(unreachable_err)?
        .error_for_status()
        .map_err(unreachable_err)?;
    let bytes = resp.bytes().map_err(unreachable_err)?;
    Ok(bytes.to_vec())
}

/// Extract `keymap.c` from an Oryx source zip (lives in `*_source/keymap.c`).
pub fn keymap_c_from_zip(zip_bytes: &[u8]) -> Result<String, AppError> {
    let reader = std::io::Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(reader)
        .map_err(|e| unreachable_err(format!("source zip: {e}")))?;
    let name = archive
        .file_names()
        .find(|n| n.ends_with("keymap.c"))
        .map(str::to_string)
        .ok_or_else(|| unreachable_err("source zip has no keymap.c"))?;
    let mut file = archive
        .by_name(&name)
        .map_err(|e| unreachable_err(format!("source zip {name}: {e}")))?;
    let mut out = String::new();
    file.read_to_string(&mut out)
        .map_err(|e| unreachable_err(format!("source zip {name}: {e}")))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn keymap_c_extracted_from_nested_zip_path() {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut buf);
            let opts: zip::write::SimpleFileOptions = Default::default();
            zip.start_file("rddD7_source/rules.mk", opts).unwrap();
            zip.write_all(b"KEY_LOCK_ENABLE = yes\n").unwrap();
            zip.start_file("rddD7_source/keymap.c", opts).unwrap();
            zip.write_all(b"#include QMK_KEYBOARD_H\n").unwrap();
            zip.finish().unwrap();
        }
        let extracted = keymap_c_from_zip(buf.get_ref()).unwrap();
        assert_eq!(extracted, "#include QMK_KEYBOARD_H\n");
    }

    #[test]
    fn zip_without_keymap_is_oryx_unreachable() {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut buf);
            let opts: zip::write::SimpleFileOptions = Default::default();
            zip.start_file("readme.txt", opts).unwrap();
            zip.write_all(b"hi").unwrap();
            zip.finish().unwrap();
        }
        let err = keymap_c_from_zip(buf.get_ref()).unwrap_err();
        assert_eq!(err.code(), "OryxUnreachable");
    }
}
