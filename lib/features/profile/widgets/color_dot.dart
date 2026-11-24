import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';

/// Swatch for one of the user's favorite colors.
class ColorDot extends StatelessWidget {
  const ColorDot({super.key, required this.name});

  final String name;

  /// Palette keyed by the color vocabulary the backend accepts. Falls back to
  /// a neutral swatch so an unknown value still renders as a real dot.
  static const _palette = <String, int>{
    'Black': 0xFF1E1C1A,
    'White': 0xFFFFFFFF,
    'Beige': 0xFFE8DCC8,
    'Cream': 0xFFF6F1E7,
    'Navy': 0xFF1F2A44,
    'Blue': 0xFF3D5A80,
    'Denim': 0xFF4A6FA5,
    'Grey': 0xFF9A9A9A,
    'Charcoal': 0xFF3A3A3A,
    'Brown': 0xFF6B4A2F,
    'Tan': 0xFFC8A165,
    'Green': 0xFF3E7C4F,
    'Olive': 0xFF6B7A3A,
    'Red': 0xFFC0392B,
    'Burgundy': 0xFF6E1E2E,
    'Pink': 0xFFE8A0BF,
    'Purple': 0xFF5E4B8B,
    'Yellow': 0xFFE8C547,
    'Orange': 0xFFE07A3E,
    'Multicolor': 0xFFB8A0D0,
  };

  @override
  Widget build(BuildContext context) {
    final hex = _palette[name];
    return Tooltip(
      message: name,
      child: Container(
        width: 32,
        height: 32,
        decoration: BoxDecoration(
          color: hex == null ? AppColors.tint : Color(hex),
          shape: BoxShape.circle,
          border: Border.all(color: AppColors.border),
        ),
      ),
    );
  }
}