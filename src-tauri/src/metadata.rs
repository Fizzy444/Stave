use lofty::{
    file::{AudioFile, TaggedFileExt},
    probe::Probe,
    tag::{Accessor, ItemKey},
};
use std::path::Path;

#[derive(Debug, Default)]
pub struct TrackMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<u32>,
    pub track_no: Option<u32>,
    pub disc_no: Option<u32>,
    pub genre: Option<String>,
    pub duration_ms: Option<u64>,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
}

pub fn read_metadata(path: &Path) -> (TrackMetadata, Option<Vec<u8>>) {
    let mut metadata = TrackMetadata::default();
    let mut picture = None;

    let file_stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string());
    let parent_name = path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|s| s.to_str())
        .map(|s| s.to_string());

    if let Ok(probe) = Probe::open(path) {
        if let Ok(tagged_file) = probe.read() {
            let properties = tagged_file.properties();
            let duration = properties.duration().as_millis() as u64;
            if duration > 0 {
                metadata.duration_ms = Some(duration);
            }
            metadata.bitrate = properties.audio_bitrate();
            metadata.sample_rate = properties.sample_rate();

            if let Some(tag) = tagged_file
                .primary_tag()
                .or_else(|| tagged_file.first_tag())
            {
                metadata.title = tag.title().map(|s| s.into_owned());
                metadata.artist = tag.artist().map(|s| s.into_owned());
                metadata.album = tag.album().map(|s| s.into_owned());
                metadata.track_no = tag.track();
                metadata.disc_no = tag.disk();
                metadata.genre = tag.genre().map(|s| s.into_owned());

                if let Some(item) = tag.get(ItemKey::Year) {
                    if let lofty::tag::ItemValue::Text(val) = item.value() {
                        metadata.year = val.parse().ok();
                    }
                }

                if let Some(item) = tag.get(ItemKey::AlbumArtist) {
                    if let lofty::tag::ItemValue::Text(val) = item.value() {
                        metadata.album_artist = Some(val.to_string());
                    }
                }

                if let Some(pic) = tag.pictures().first() {
                    picture = Some(pic.data().to_vec());
                }
            }
        }
    }

    // Reliable fallbacks: ensure tracks without tags still have meaningful titles and albums
    if metadata.title.as_deref().unwrap_or("").trim().is_empty() {
        metadata.title = file_stem;
    }
    if metadata.album.as_deref().unwrap_or("").trim().is_empty() {
        metadata.album = parent_name;
    }

    (metadata, picture)
}
