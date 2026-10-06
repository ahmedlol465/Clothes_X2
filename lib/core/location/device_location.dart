import 'dart:convert';

import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;

/// Phone GPS coordinates for the weather lookup.
///
/// Returns `null` whenever the position cannot be determined: location
/// services off, permission denied (including permanently), timeout, or any
/// platform error. Callers must fall back to a default city — never block the
/// UI waiting for GPS.
Future<({double lat, double lon})?> currentCoords() async {
  try {
    if (!await Geolocator.isLocationServiceEnabled()) return null;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      return null;
    }
    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.low,
        timeLimit: Duration(seconds: 8),
      ),
    );
    return (lat: position.latitude, lon: position.longitude);
  } catch (_) {
    return null;
  }
}

/// Approximate coordinates from the public IP address (keyless ipwho.is).
///
/// This is the fallback for when GPS is unavailable — notably on Chrome/web,
/// where the browser geolocation prompt is often denied or never appears, and
/// the app would otherwise fall back to the backend default city. Accuracy is
/// city-level (and wrong under VPNs), so GPS always takes precedence.
///
/// Returns `null` on any failure (rate limit, offline, malformed payload) —
/// callers must fall back to the default city, never block the UI.
Future<({double lat, double lon, String? city})?> ipCoords() async {
  try {
    final res = await http
        .get(Uri.parse('https://ipwho.is/'))
        .timeout(const Duration(seconds: 8));
    if (res.statusCode != 200) return null;
    final data = jsonDecode(res.body);
    if (data is! Map) return null;
    if (data['success'] == false) return null;
    final lat = (data['latitude'] as num?)?.toDouble();
    final lon = (data['longitude'] as num?)?.toDouble();
    if (lat == null || lon == null) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    final city = (data['city'] as String?)?.trim();
    return (
      lat: lat,
      lon: lon,
      city: city == null || city.isEmpty ? null : city,
    );
  } catch (_) {
    return null;
  }
}
