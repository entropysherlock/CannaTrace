/**
 * Product photos for the public menu, by item name. Names are matched with capitals, spaces and punctuation
 * ignored, so "Desert Haze 1 g Pre-roll" and "Desert Haze 1g Pre-Roll" get the same picture. An item with no
 * entry here shows the colored leaf header instead.
 * Files live in public/menu-images (600x600, white background).
 */
const IMAGES: Record<string, string> = {
  "1gramgg4": "/menu-images/1gramgg4.webp",
  "bluedream7g": "/menu-images/bluedream7g.webp",
  "bluemesa35gjar": "/menu-images/bluemesa35gjar.webp",
  "bluemesaflowerbulk": "/menu-images/bluemesaflowerbulk.webp",
  "bulkbluedreamshake": "/menu-images/bulkbluedreamshake.webp",
  "bulkdeserthazeflower": "/menu-images/bulkdeserthazeflower.webp",
  "deserthazeflowerbulk": "/menu-images/deserthazeflowerbulk.webp",
  "greencrack35gjar": "/menu-images/greencrack35gjar.webp",
  "greencrack7gpouch": "/menu-images/greencrack7gpouch.webp",
  "jackherer28gbag": "/menu-images/jackherer28gbag.webp",
  "mac114gbag": "/menu-images/mac114gbag.webp",
  "pinepeakflower1g": "/menu-images/pinepeakflower1g.webp",
  "pineappleexpress35gjar": "/menu-images/pineappleexpress35gjar.webp",
  "pineappleexpress7gpouch": "/menu-images/pineappleexpress7gpouch.webp",
  "sandiasunset35gjar": "/menu-images/sandiasunset35gjar.webp",
  "sandiasunsetflowerbulk": "/menu-images/sandiasunsetflowerbulk.webp",
  "sourdiesel35gjar": "/menu-images/sourdiesel35gjar.webp",
  "sourdiesel14gbag": "/menu-images/sourdiesel14gbag.webp",
  "sourdiesel28gbag": "/menu-images/sourdiesel28gbag.webp",
  "sunsetgelato7gpouch": "/menu-images/sunsetgelato7gpouch.webp",
  "deserthaze1gpreroll": "/menu-images/deserthaze1gpreroll.webp",
  "deserthaze2x05gpack": "/menu-images/deserthaze2x05gpack.webp",
  "deserthaze5x1gpack": "/menu-images/deserthaze5x1gpack.webp",
  "bluemesa5x1gpack": "/menu-images/bluemesa5x1gpack.webp",
  "bluemesa1gdisposable": "/menu-images/bluemesa1gdisposable.webp",
  "deserthaze05gcartridge": "/menu-images/deserthaze05gcartridge.webp",
  "pineapplehaze1gcartridge": "/menu-images/pineapplehaze1gcartridge.webp",
  "sunsetgelato1gdisposable": "/menu-images/sunsetgelato1gdisposable.webp",
  "greenchileogliveresin1g": "/menu-images/greenchileogliveresin1g.webp",
  "purplepunch1gliveresin": "/menu-images/purplepunch1gliveresin.webp",
  "purplepunch2gwax": "/menu-images/purplepunch2gwax.webp",
  "adobedreamgummies10pk100mg": "/menu-images/adobedreamgummies10pk100mg.webp",
  "berrymesa20x5mggummies": "/menu-images/berrymesa20x5mggummies.webp",
  "peachcanyon20x5mggummies": "/menu-images/peachcanyon20x5mggummies.webp",
  "pricklypeargummies10pack": "/menu-images/pricklypeargummies10pack.webp",
  "adobedreambalm2oz": "/menu-images/adobedreambalm2oz.webp",
  "lavenderreliefbalm1oz": "/menu-images/lavenderreliefbalm1oz.webp",
  "lavenderrelief4ozlotion": "/menu-images/lavenderrelief4ozlotion.webp",
  "mesarelief1ozsalve": "/menu-images/mesarelief1ozsalve.webp",
  "horchatacoldbrew10mg": "/menu-images/horchatacoldbrew10mg.webp",
  "nightbloom30mlbottle": "/menu-images/nightbloom30mlbottle.webp",
};

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

export function menuImageFor(name: string): string | null {
  return IMAGES[key(name)] ?? null;
}
