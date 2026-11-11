$repos = @(
  @{ dir = "external-repos/part1-acoustic"; url = "https://github.com/ggerganov/ggwave.git" },
  @{ dir = "external-repos/part1-acoustic"; url = "https://github.com/quiet/quiet-js.git" },
  @{ dir = "external-repos/part1-acoustic"; url = "https://github.com/chirp/chirp-js.git" },
  @{ dir = "external-repos/part1-acoustic"; url = "https://github.com/kamalmostafa/minimodem.git" },
  @{ dir = "external-repos/part1-acoustic"; url = "https://github.com/thesephist/webaudio-modem.git" },

  @{ dir = "external-repos/part2-p2p"; url = "https://github.com/schlagmichdoch/PairDrop.git" },
  @{ dir = "external-repos/part2-p2p"; url = "https://github.com/RobinLinus/snapdrop.git" },
  @{ dir = "external-repos/part2-p2p"; url = "https://github.com/cowbell/sharedrop.git" },
  @{ dir = "external-repos/part2-p2p"; url = "https://github.com/peers/peerjs.git" },
  @{ dir = "external-repos/part2-p2p"; url = "https://github.com/feross/simple-peer.git" },

  @{ dir = "external-repos/part3-offline"; url = "https://github.com/serwist/serwist.git" },
  @{ dir = "external-repos/part3-offline"; url = "https://github.com/GoogleChrome/workbox.git" },
  @{ dir = "external-repos/part3-offline"; url = "https://github.com/dexie/Dexie.js.git" },
  @{ dir = "external-repos/part3-offline"; url = "https://github.com/jakearchibald/idb-keyval.git" },
  @{ dir = "external-repos/part3-offline"; url = "https://github.com/localForage/localForage.git" },

  @{ dir = "external-repos/part4-bubble-ui"; url = "https://github.com/motiondivision/motion.git" },
  @{ dir = "external-repos/part4-bubble-ui"; url = "https://github.com/liabru/matter-js.git" },
  @{ dir = "external-repos/part4-bubble-ui"; url = "https://github.com/d3/d3-force.git" },
  @{ dir = "external-repos/part4-bubble-ui"; url = "https://github.com/pmndrs/react-spring.git" },
  @{ dir = "external-repos/part4-bubble-ui"; url = "https://github.com/tsparticles/tsparticles.git" },
  @{ dir = "external-repos/part4-bubble-ui"; url = "https://github.com/airbnb/lottie-web.git" },
  @{ dir = "external-repos/part4-bubble-ui"; url = "https://github.com/catdad/canvas-confetti.git" },
  @{ dir = "external-repos/part4-bubble-ui"; url = "https://github.com/emilkowalski/vaul.git" },
  @{ dir = "external-repos/part4-bubble-ui"; url = "https://github.com/emilkowalski/sonner.git" },
  @{ dir = "external-repos/part4-bubble-ui"; url = "https://github.com/radix-ui/primitives.git" },

  @{ dir = "external-repos/part5-ui-audio"; url = "https://github.com/joshwcomeau/use-sound.git" },
  @{ dir = "external-repos/part5-ui-audio"; url = "https://github.com/Tonejs/Tone.js.git" },
  @{ dir = "external-repos/part5-ui-audio"; url = "https://github.com/goldfire/howler.js.git" },
  @{ dir = "external-repos/part5-ui-audio"; url = "https://github.com/KilledByAPixel/ZzFX.git" },
  @{ dir = "external-repos/part5-ui-audio"; url = "https://github.com/alemangui/pizzicato.git" },

  @{ dir = "external-repos/part6-dsp-viz"; url = "https://github.com/indutny/fft.js.git" },
  @{ dir = "external-repos/part6-dsp-viz"; url = "https://github.com/corbanbrook/dsp.js.git" },
  @{ dir = "external-repos/part6-dsp-viz"; url = "https://github.com/meyda/meyda.git" },
  @{ dir = "external-repos/part6-dsp-viz"; url = "https://github.com/katspaugh/wavesurfer.js.git" },
  @{ dir = "external-repos/part6-dsp-viz"; url = "https://github.com/hvianna/audioMotion-analyzer.git" },
  @{ dir = "external-repos/part6-dsp-viz"; url = "https://github.com/MTG/essentia.js.git" },
  @{ dir = "external-repos/part6-dsp-viz"; url = "https://github.com/Ravenstine/goertzel-node.git" },

  @{ dir = "external-repos/part7-fec-compression"; url = "https://github.com/101arrowz/fflate.git" },
  @{ dir = "external-repos/part7-fec-compression"; url = "https://github.com/darrenldl/reed-solomon-erasure.git" },
  @{ dir = "external-repos/part7-fec-compression"; url = "https://github.com/SheetJS/js-crc32.git" },
  @{ dir = "external-repos/part7-fec-compression"; url = "https://github.com/pieroxy/lz-string.git" },
  @{ dir = "external-repos/part7-fec-compression"; url = "https://github.com/ilariont/hamming-code.git" },
  @{ dir = "external-repos/part7-fec-compression"; url = "https://github.com/nodeca/pako.git" },
  @{ dir = "external-repos/part7-fec-compression"; url = "https://github.com/httptoolkit/brotli-wasm.git" },

  @{ dir = "external-repos/part8-crypto-media"; url = "https://github.com/Donaldcwl/browser-image-compression.git" },
  @{ dir = "external-repos/part8-crypto-media"; url = "https://github.com/woltapp/blurhash.git" },
  @{ dir = "external-repos/part8-crypto-media"; url = "https://github.com/dchest/tweetnacl-js.git" },
  @{ dir = "external-repos/part8-crypto-media"; url = "https://github.com/GoogleChromeLabs/comlink.git" },
  @{ dir = "external-repos/part8-crypto-media"; url = "https://github.com/pmndrs/zustand.git" },
  @{ dir = "external-repos/part8-crypto-media"; url = "https://github.com/lucide-icons/lucide.git" }
)

foreach ($item in $repos) {
  $targetDir = $item.dir
  $repoUrl = $item.url
  $repoName = [System.IO.Path]::GetFileNameWithoutExtension($repoUrl)
  $fullPath = Join-Path $targetDir $repoName
  
  if (-not (Test-Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  }
  
  if (-not (Test-Path $fullPath)) {
    Write-Host "Cloning $repoName into $targetDir..."
    git clone --depth 1 $repoUrl $fullPath
  } else {
    Write-Host "$repoName already exists in $targetDir, skipping."
  }
}
Write-Host "All repositories cloned successfully."
