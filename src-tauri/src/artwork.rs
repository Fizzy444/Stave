use image::{imageops::FilterType, GenericImageView};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct ArtworkProcessor {
    cache_dir: PathBuf,
    mem_cache: Mutex<HashMap<String, String>>,
}

// --- Color math helpers ---

/// Convert RGB [0..1] to HSL
fn rgb_to_hsl(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;

    if (max - min).abs() < 1e-6 {
        return (0.0, 0.0, l);
    }

    let d = max - min;
    let s = if l > 0.5 {
        d / (2.0 - max - min)
    } else {
        d / (max + min)
    };

    let h = if (max - r).abs() < 1e-6 {
        let mut h = (g - b) / d;
        if g < b {
            h += 6.0;
        }
        h
    } else if (max - g).abs() < 1e-6 {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };

    (h / 6.0, s, l)
}

/// Convert HSL back to RGB [0..1]
fn hsl_to_rgb(h: f32, s: f32, l: f32) -> (f32, f32, f32) {
    if s.abs() < 1e-6 {
        return (l, l, l);
    }

    let q = if l < 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let p = 2.0 * l - q;

    fn hue_to_rgb(p: f32, q: f32, mut t: f32) -> f32 {
        if t < 0.0 {
            t += 1.0;
        }
        if t > 1.0 {
            t -= 1.0;
        }
        if t < 1.0 / 6.0 {
            return p + (q - p) * 6.0 * t;
        }
        if t < 0.5 {
            return q;
        }
        if t < 2.0 / 3.0 {
            return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
        }
        p
    }

    (
        hue_to_rgb(p, q, h + 1.0 / 3.0),
        hue_to_rgb(p, q, h),
        hue_to_rgb(p, q, h - 1.0 / 3.0),
    )
}

impl ArtworkProcessor {
    pub fn new(app_data_dir: &Path) -> Self {
        let cache_dir = app_data_dir.join("artwork");
        fs::create_dir_all(&cache_dir).ok();
        Self {
            cache_dir,
            mem_cache: Mutex::new(HashMap::new()),
        }
    }

    pub fn process(&self, data: &[u8]) -> Option<(String, String)> {
        if data.is_empty() {
            return None;
        }

        // Deterministic SHA-256 hash (consistent across sessions, fast, collision-resistant)
        let mut hasher = Sha256::new();
        hasher.update(data);
        let result = hasher.finalize();
        let mut hash = String::with_capacity(64);
        for byte in result {
            use std::fmt::Write;
            let _ = write!(&mut hash, "{:02x}", byte);
        }

        // 1. In-memory cache hit (extremely fast for albums where multiple tracks share the same art)
        if let Ok(cache) = self.mem_cache.lock() {
            if let Some(accent) = cache.get(&hash) {
                return Some((hash.clone(), accent.clone()));
            }
        }

        let out_300 = self.cache_dir.join(format!("{}_300.webp", hash));
        let out_800 = self.cache_dir.join(format!("{}_800.webp", hash));
        let accent_file = self.cache_dir.join(format!("{}_accent.txt", hash));

        // 2. On-disk cache check (skips decoding/resizing completely on repeat runs)
        if out_300.exists() && out_800.exists() && accent_file.exists() {
            if let Ok(cached_accent) = fs::read_to_string(&accent_file) {
                let acc = cached_accent.trim().to_string();
                if let Ok(mut cache) = self.mem_cache.lock() {
                    cache.insert(hash.clone(), acc.clone());
                }
                return Some((hash, acc));
            }
        }

        let accent;

        if let Ok(img) = image::load_from_memory(data) {
            // --- Step 1: Sample pixels into HSL and bucket by hue ---
            let img_small = img.resize_exact(64, 64, FilterType::Triangle);

            // Collect all saturated pixels as HSL
            let mut candidates: Vec<(f32, f32, f32, f32)> = Vec::new(); // (h, s, l, score)

            for pixel in img_small.pixels() {
                let rgba = pixel.2;
                let r = rgba[0] as f32 / 255.0;
                let g = rgba[1] as f32 / 255.0;
                let b = rgba[2] as f32 / 255.0;

                let (h, s, l) = rgb_to_hsl(r, g, b);

                // Skip near-gray, near-black, near-white pixels
                if s < 0.15 || l < 0.08 || l > 0.92 {
                    continue;
                }

                // Score: heavily weight saturation, prefer mid-range lightness
                let lightness_score = 1.0 - (l - 0.55).abs() * 1.5;
                let score = s * lightness_score.max(0.0);

                candidates.push((h, s, l, score));
            }

            // --- Step 2: Find the dominant vibrant color via hue bucketing ---
            let num_buckets = 12;
            let mut buckets: Vec<(f32, f32, f32, f32, u32)> =
                vec![(0.0, 0.0, 0.0, 0.0, 0); num_buckets];

            for &(h, s, l, score) in &candidates {
                let bucket_idx = ((h * num_buckets as f32) as usize).min(num_buckets - 1);
                buckets[bucket_idx].0 += h;
                buckets[bucket_idx].1 += s;
                buckets[bucket_idx].2 += l;
                buckets[bucket_idx].3 += score;
                buckets[bucket_idx].4 += 1;
            }

            let mut best_bucket = 0usize;
            let mut best_bucket_score: f32 = -1.0;

            for (i, b) in buckets.iter().enumerate() {
                if b.4 == 0 {
                    continue;
                }
                let composite = b.3 * (b.4 as f32).sqrt();
                if composite > best_bucket_score {
                    best_bucket_score = composite;
                    best_bucket = i;
                }
            }

            let (final_h, final_s, final_l);

            if best_bucket_score > 0.0 && buckets[best_bucket].4 > 0 {
                let b = &buckets[best_bucket];
                let count = b.4 as f32;
                final_h = b.0 / count;
                final_s = (b.1 / count).max(0.6);
                final_l = (b.2 / count).clamp(0.50, 0.65);
            } else {
                let avg = img.resize_exact(1, 1, FilterType::Triangle);
                if let Some(p) = avg.pixels().next() {
                    let (h, s, l) = rgb_to_hsl(
                        p.2[0] as f32 / 255.0,
                        p.2[1] as f32 / 255.0,
                        p.2[2] as f32 / 255.0,
                    );
                    final_h = h;
                    final_s = s.max(0.4);
                    final_l = l.clamp(0.45, 0.60);
                } else {
                    final_h = 0.6;
                    final_s = 0.7;
                    final_l = 0.55;
                }
            }

            // --- Step 3: Convert back to RGB ---
            let (r, g, b) = hsl_to_rgb(final_h, final_s, final_l);

            let final_r = (r * 255.0).round() as u8;
            let final_g = (g * 255.0).round() as u8;
            let final_b = (b * 255.0).round() as u8;

            accent = format!("#{:02x}{:02x}{:02x}", final_r, final_g, final_b);

            // Use fast Triangle (bilinear) resampling instead of heavy Lanczos3 for 10-15x speedup
            if !out_300.exists() || !out_800.exists() {
                let img_300 = img.resize_to_fill(300, 300, FilterType::Triangle);
                let img_800 = img.resize_to_fill(800, 800, FilterType::Triangle);

                let _ = img_300.save(&out_300);
                let _ = img_800.save(&out_800);
            }

            // Save the extracted color for next time
            let _ = fs::write(&accent_file, &accent);
            if let Ok(mut cache) = self.mem_cache.lock() {
                cache.insert(hash.clone(), accent.clone());
            }
        } else {
            return None;
        }

        Some((hash, accent))
    }
}
