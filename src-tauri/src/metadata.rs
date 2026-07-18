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
    pub picture: Option<Vec<u8>>,
}

pub fn read_metadata(path: &Path) -> Option<TrackMetadata> {
    let tagged_file = Probe::open(path).ok()?.read().ok()?;

    let mut metadata = TrackMetadata::default();

    let properties = tagged_file.properties();
    metadata.duration_ms = Some(properties.duration().as_millis() as u64);
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
            metadata.picture = Some(pic.data().to_vec());
        }
    }

    Some(metadata)
}
