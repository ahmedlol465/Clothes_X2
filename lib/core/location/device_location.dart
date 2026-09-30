import 'package:geolocator/geolocator.dart';

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
