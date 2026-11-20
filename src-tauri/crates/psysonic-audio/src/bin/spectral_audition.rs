//! Explicit local-only listening lab. Never loads music automatically, writes
//! database rows, downloads audio, or changes the running Psysonic player.

use std::path::PathBuf;

fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let mut outgoing = None;
    let mut incoming = None;
    let mut output = None;
    let mut overlap_secs = 3.5f64;
    let mut seed = None;

    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--outgoing" => outgoing = Some(PathBuf::from(
                args.next().ok_or("--outgoing requires a file path")?,
            )),
            "--incoming" => incoming = Some(PathBuf::from(
                args.next().ok_or("--incoming requires a file path")?,
            )),
            "--output" => output = Some(PathBuf::from(
                args.next().ok_or("--output requires a directory")?,
            )),
            "--overlap" => {
                overlap_secs = args.next().ok_or("--overlap requires seconds")?
                    .parse().map_err(|_| "Invalid overlap seconds")?;
            }
            "--seed" => {
                seed = Some(args.next().ok_or("--seed requires an integer")?
                    .parse::<u64>().map_err(|_| "Invalid seed")?);
            }
            "--help" | "-h" => {
                println!("Spectral AutoDJ local blind A/B audition");
                println!("--outgoing FILE --incoming FILE --output DIRECTORY [--overlap 3.5] [--seed 42]");
                println!("Accepted: complete mono/stereo original files <=64 MiB.");
                println!("Only two 48 kHz stereo WAVs and a private answer key are written.");
                return Ok(());
            }
            _ => return Err(format!("Unknown argument {flag}; use --help")),
        }
    }
    let outgoing = outgoing.ok_or("Missing --outgoing FILE")?;
    let incoming = incoming.ok_or("Missing --incoming FILE")?;
    let output = output.ok_or("Missing --output DIRECTORY")?;
    let seed = seed.unwrap_or_else(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64
    });

    let report = psysonic_audio::spectral_audition::render_audition_pair(
        &outgoing, &incoming, &output, overlap_secs, seed,
    )?;
    println!("Created Sample_1.wav, Sample_2.wav and private ANSWER_KEY.txt");
    println!("Duration: {:.2} sec; overlap {:.2} sec", report.duration_secs, report.overlap_secs);
    println!("Broadband RMS match delta: {:.4} dB; peak: {:.4}",
        report.rms_difference_db, report.max_sample);
    println!("Keep the answer key hidden until after rating both clips.");
    if report.intro_low_cut_db == 0.0 {
        println!("Neutral-control pair: the source spectra did not justify a bass cut.");
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Spectral audition failed: {error}");
        std::process::exit(1);
    }
}
