import 'package:flutter/material.dart';

import '../../core/api/api_config.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_widgets.dart';

/// Candidate visuals for the Avatar Stylist result. Exactly one of these
/// survives once the user picks; the other gets deleted with this file.

/// Option A: clean flat-lay board. Pieces arranged as neat tiles on a plain
/// background, biggest pieces first. No mannequin.
class FlatLayBoard extends StatelessWidget {
  const FlatLayBoard({super.key, required this.items});

  final List<Map<String, dynamic>> items;

  @override
  Widget build(BuildContext context) {
    final ordered = [...items]..sort((a, b) {
        const rank = {'top': 0, 'outerwear': 1, 'bottom': 2, 'shoes': 3, 'accessory': 4};
        return (rank['${a['slot']}'] ?? 9).compareTo(rank['${b['slot']}'] ?? 9);
      });
    return Center(
      child: SwCard(
        padding: const EdgeInsets.all(Insets.lg),
        child: SizedBox(
          width: 320,
          height: 400,
          child: Column(
            children: [
              Align(
                alignment: Alignment.centerRight,
                child: Text('FLAT LAY', style: AppText.overline),
              ),
              const SizedBox(height: Insets.sm),
              Expanded(
                child: Row(
                  children: [
                    for (final item in ordered.take(2)) ...[
                      if (ordered.indexOf(item) > 0) const SizedBox(width: Insets.md),
                      Expanded(child: _tile(item, label: true)),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: Insets.md),
              Expanded(
                child: Row(
                  children: [
                    for (final item in ordered.skip(2).take(3)) ...[
                      if (ordered.skip(2).take(3).toList().indexOf(item) > 0)
                        const SizedBox(width: Insets.md),
                      Expanded(child: _tile(item, label: true)),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _tile(Map<String, dynamic> item, {bool label = false}) {
    return Column(
      children: [
        Expanded(
          child: Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: Radii.tileRadius,
              border: Border.all(color: AppColors.border),
            ),
            padding: const EdgeInsets.all(Insets.sm),
            child: SwProductImage(
              image: '${item['imageUrl'] ?? ''}',
              radius: Radii.sm,
              background: Colors.white,
            ),
          ),
        ),
        if (label) ...[
          const SizedBox(height: 4),
          Text(
            '${item['slot'] ?? ''}'.toUpperCase(),
            style: AppText.overline,
            textAlign: TextAlign.center,
          ),
        ],
      ],
    );
  }
}

/// Option B: a stylized illustrated figure with the pieces fitted in proper
/// body positions: top on the torso, bottom on the legs, shoes at the feet.
class FigureVisual extends StatelessWidget {
  const FigureVisual({super.key, required this.items});

  final List<Map<String, dynamic>> items;

  Map<String, dynamic>? _slot(String slot) {
    for (final item in items) {
      if (item['slot'] == slot) return item;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    const w = 320.0;
    const h = 420.0;
    Widget fitted(String slot, double top, double left, double size) {
      final item = _slot(slot);
      if (item == null) return const SizedBox.shrink();
      // Remote product photos go through the cutout endpoint so the plain
      // studio background is removed and the piece sits on the figure;
      // bundled assets already have transparent/neutral backgrounds.
      final raw = '${item['imageUrl'] ?? ''}';
      final image = raw.startsWith('http')
          ? '${ApiConfig.baseUrl}/shop/cutout?u=${Uri.encodeComponent(raw)}'
          : raw;
      return Positioned(
        top: top,
        left: left,
        width: size,
        height: size,
        child: ClipRRect(
          borderRadius: Radii.smRadius,
          child: SwProductImage(image: image, background: Colors.transparent),
        ),
      );
    }

    return Center(
      child: SwCard(
        padding: EdgeInsets.zero,
        clip: true,
        child: SizedBox(
          width: w,
          height: h,
          child: Stack(
            children: [
              Positioned.fill(
                child: ColoredBox(
                  color: AppColors.background,
                  child: CustomPaint(painter: _FigurePainter()),
                ),
              ),
              // Body-position fitting on the 320x420 figure: head center is
              // (160, 58), torso 96-206, legs 206-360, feet 360-400.
              fitted('top', 100, 114, 92),
              fitted('bottom', 200, 118, 88),
              fitted('shoes', 344, 118, 84),
              fitted('outerwear', 108, 212, 76),
              fitted('accessory', 216, 30, 60),
            ],
          ),
        ),
      ),
    );
  }
}

/// Simple stylized figure: head, neck, tapered torso, arms and legs in one
/// soft neutral fill, drawn so the garment photos read as "worn".
class _FigurePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = const Color(0xFFE7E0D4);
    final outline = Paint()
      ..color = const Color(0xFFD8CFBF)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;

    // Head
    canvas.drawOval(Rect.fromCenter(center: const Offset(160, 58), width: 44, height: 54), paint);
    // Neck
    canvas.drawRect(const Rect.fromLTWH(150, 82, 20, 18), paint);
    // Torso (slightly tapered)
    final torso = Path()
      ..moveTo(112, 100)
      ..lineTo(208, 100)
      ..lineTo(200, 208)
      ..lineTo(120, 208)
      ..close();
    canvas.drawPath(torso, paint);
    canvas.drawPath(torso, outline);
    // Arms
    for (final left in [true, false]) {
      final arm = Path();
      if (left) {
        arm..moveTo(112, 102)..lineTo(96, 106)..lineTo(88, 196)..lineTo(102, 198)..close();
      } else {
        arm..moveTo(208, 102)..lineTo(224, 106)..lineTo(232, 196)..lineTo(218, 198)..close();
      }
      canvas.drawPath(arm, paint);
    }
    // Legs
    for (final dx in [0.0, 46.0]) {
      final leg = RRect.fromRectAndRadius(
        Rect.fromLTWH(120 + dx, 208, 34, 160),
        const Radius.circular(12),
      );
      canvas.drawRRect(leg, paint);
    }
    // Feet hint
    for (final dx in [0.0, 46.0]) {
      canvas.drawOval(Rect.fromLTWH(112 + dx, 360, 44, 22), paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
