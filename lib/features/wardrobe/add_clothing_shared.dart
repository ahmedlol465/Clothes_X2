import 'dart:typed_data';

/// Phase of a staged photo in the add clothing flow.
enum Phase { pending, staging, ready, saving, done, error }

/// A photo picked by the user, staged for upload/analysis.
class Staged {
  Staged({
    required this.filename,
    required this.bytes,
    required this.mimeType,
  });

  final String filename;
  final Uint8List bytes;
  final String mimeType;
  Phase phase = Phase.pending;
  String? url;
  Map<String, dynamic> analysis = {};
  String source = 'heuristic';
  String? error;
}

/// Mapping from UI label to analysis JSON key.
const tagFields = <String, String>{
  'CATEGORY': 'category',
  'COLOR': 'color',
  'STYLE': 'style',
  'PATTERN': 'pattern',
  'MATERIAL': 'material',
  'SEASON': 'season',
  'FORMALITY': 'formality',
};

/// Get the display value for a tag field from analysis JSON.
String tagValue(Map<String, dynamic> analysis, String label) {
  const defaults = {
    'CATEGORY': 'Tops',
    'COLOR': 'White',
    'STYLE': 'Casual',
    'PATTERN': 'Plain',
    'MATERIAL': 'Cotton',
    'SEASON': 'All Season',
    'FORMALITY': 'Casual',
  };
  final v = analysis[tagFields[label]];
  if (v == null || '$v'.isEmpty) return defaults[label]!;
  return '$v';
}

/// Guess MIME type from filename extension.
String guessMime(String name) {
  final n = name.toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.heic') || n.endsWith('.heif')) return 'image/heic';
  return 'image/jpeg';
}