// Curated list of major world cities used to label the globe. The list is
// chosen for geographic orientation (capitals plus a handful of historic war
// cities), not for exhaustiveness. Labels fade in at lower altitudes so they
// don't crowd the global view.

export interface CityLabel {
  name: string;
  lat: number;
  lng: number;
  // tier controls reveal: 0 = always visible (continental anchors), 1 = mid
  // zoom, 2 = close zoom only.
  tier: 0 | 1 | 2;
}

export const CITIES: CityLabel[] = [
  // Tier 0: always-on anchors, one or two per continent
  { name: 'New York', lat: 40.7128, lng: -74.006, tier: 0 },
  { name: 'London', lat: 51.5074, lng: -0.1278, tier: 0 },
  { name: 'Moscow', lat: 55.7558, lng: 37.6173, tier: 0 },
  { name: 'Beijing', lat: 39.9042, lng: 116.4074, tier: 0 },
  { name: 'Tokyo', lat: 35.6762, lng: 139.6503, tier: 0 },
  { name: 'Cairo', lat: 30.0444, lng: 31.2357, tier: 0 },
  { name: 'Mumbai', lat: 19.076, lng: 72.8777, tier: 0 },
  { name: 'Sydney', lat: -33.8688, lng: 151.2093, tier: 0 },
  { name: 'Buenos Aires', lat: -34.6037, lng: -58.3816, tier: 0 },

  // Tier 1: major capitals
  { name: 'Washington', lat: 38.9072, lng: -77.0369, tier: 1 },
  { name: 'Paris', lat: 48.8566, lng: 2.3522, tier: 1 },
  { name: 'Berlin', lat: 52.52, lng: 13.405, tier: 1 },
  { name: 'Rome', lat: 41.9028, lng: 12.4964, tier: 1 },
  { name: 'Madrid', lat: 40.4168, lng: -3.7038, tier: 1 },
  { name: 'Vienna', lat: 48.2082, lng: 16.3738, tier: 1 },
  { name: 'Warsaw', lat: 52.2297, lng: 21.0122, tier: 1 },
  { name: 'Kyiv', lat: 50.4501, lng: 30.5234, tier: 1 },
  { name: 'Istanbul', lat: 41.0082, lng: 28.9784, tier: 1 },
  { name: 'Athens', lat: 37.9838, lng: 23.7275, tier: 1 },
  { name: 'Jerusalem', lat: 31.7683, lng: 35.2137, tier: 1 },
  { name: 'Baghdad', lat: 33.3152, lng: 44.3661, tier: 1 },
  { name: 'Tehran', lat: 35.6892, lng: 51.389, tier: 1 },
  { name: 'Riyadh', lat: 24.7136, lng: 46.6753, tier: 1 },
  { name: 'Seoul', lat: 37.5665, lng: 126.978, tier: 1 },
  { name: 'Hanoi', lat: 21.0285, lng: 105.8542, tier: 1 },
  { name: 'Bangkok', lat: 13.7563, lng: 100.5018, tier: 1 },
  { name: 'Mexico City', lat: 19.4326, lng: -99.1332, tier: 1 },
  { name: 'Rio de Janeiro', lat: -22.9068, lng: -43.1729, tier: 1 },
  { name: 'Lagos', lat: 6.5244, lng: 3.3792, tier: 1 },
  { name: 'Nairobi', lat: -1.2921, lng: 36.8219, tier: 1 },
  { name: 'Johannesburg', lat: -26.2041, lng: 28.0473, tier: 1 },
  { name: 'Toronto', lat: 43.6532, lng: -79.3832, tier: 1 },
  { name: 'Stockholm', lat: 59.3293, lng: 18.0686, tier: 1 },
  { name: 'Amsterdam', lat: 52.3676, lng: 4.9041, tier: 1 },
  { name: 'Brussels', lat: 50.8503, lng: 4.3517, tier: 1 },
  { name: 'Prague', lat: 50.0755, lng: 14.4378, tier: 1 },
  { name: 'Budapest', lat: 47.4979, lng: 19.0402, tier: 1 },
  { name: 'Lisbon', lat: 38.7223, lng: -9.1393, tier: 1 },

  // Tier 2: war-relevant geography, only visible when zoomed in
  { name: 'Volgograd (Stalingrad)', lat: 48.708, lng: 44.5133, tier: 2 },
  { name: 'Sedan', lat: 49.7, lng: 4.9444, tier: 2 },
  { name: 'Dunkirk', lat: 51.0344, lng: 2.3768, tier: 2 },
  { name: 'Verdun', lat: 49.1597, lng: 5.3828, tier: 2 },
  { name: 'Caen', lat: 49.1829, lng: -0.3707, tier: 2 },
  { name: 'Bastogne', lat: 50.0019, lng: 5.7197, tier: 2 },
  { name: 'Kursk', lat: 51.7373, lng: 36.1873, tier: 2 },
  { name: 'Sevastopol', lat: 44.6166, lng: 33.5254, tier: 2 },
  { name: 'Gettysburg', lat: 39.831, lng: -77.232, tier: 2 },
  { name: 'Antietam', lat: 39.4709, lng: -77.7414, tier: 2 },
  { name: 'Vicksburg', lat: 32.3526, lng: -90.8779, tier: 2 },
  { name: 'Yorktown', lat: 37.2387, lng: -76.5097, tier: 2 },
  { name: 'Saratoga', lat: 43.005, lng: -73.7857, tier: 2 },
  { name: 'Pearl Harbor', lat: 21.3649, lng: -157.95, tier: 2 },
  { name: 'Midway', lat: 28.2072, lng: -177.3735, tier: 2 },
  { name: 'Iwo Jima', lat: 24.7796, lng: 141.323, tier: 2 },
  { name: 'Okinawa', lat: 26.3344, lng: 127.8056, tier: 2 },
  { name: 'Guadalcanal', lat: -9.428, lng: 160.0492, tier: 2 },
  { name: 'Hue', lat: 16.4637, lng: 107.5909, tier: 2 },
  { name: 'Khe Sanh', lat: 16.6566, lng: 106.728, tier: 2 },
  { name: 'Inchon', lat: 37.4563, lng: 126.7052, tier: 2 },
  { name: 'Mogadishu', lat: 2.0469, lng: 45.3182, tier: 2 },
  { name: 'Marathon', lat: 38.1486, lng: 23.9794, tier: 2 },
  { name: 'Thermopylae', lat: 38.7956, lng: 22.5347, tier: 2 },
  { name: 'Cannae', lat: 41.3008, lng: 16.1267, tier: 2 },
  { name: 'Constantinople', lat: 41.0082, lng: 28.9784, tier: 2 },
  { name: 'Hastings', lat: 50.911, lng: 0.4865, tier: 2 },
  { name: 'Agincourt', lat: 50.4633, lng: 2.1392, tier: 2 },
  { name: 'Waterloo', lat: 50.6803, lng: 4.4124, tier: 2 },
];

// HI_RES_EARTH is the NASA Blue Marble Next Generation color texture at
// 5400x2700, self-hosted from /public/textures so it's same-origin (no CORS
// surprises) and we control caching. ~2.2MB; cached after first load. The
// resolution boost (2K → 5.4K) is what makes close-zoom replays not look like
// a pixel smear.
export const HI_RES_EARTH = '/textures/earth-blue-marble-5k.jpg';

// TOPOLOGY_BUMP gives the globe a relief feel. Bumpy mountains and ocean
// floor. Used as bump map on top of HI_RES_EARTH.
export const TOPOLOGY_BUMP =
  'https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-topology.png';

// NIGHT_SKY is the background dome behind the globe.
export const NIGHT_SKY =
  'https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/night-sky.png';
