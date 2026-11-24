import 'package:flutter/material.dart';

import 'package:smartwardrobe/core/theme/app_colors.dart';

class TypingDots extends StatefulWidget {
  const TypingDots({super.key});

  @override
  State<TypingDots> createState() => _TypingDotsState();
}

class _TypingDotsState extends State<TypingDots>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) => Row(
        mainAxisSize: MainAxisSize.min,
        children: List.generate(3, (i) {
          final phase = (_controller.value * 3 - i).clamp(0.0, 1.0);
          final lift = (phase < 0.5 ? phase : 1 - phase) * 4;
          return Padding(
            padding: EdgeInsets.only(right: i == 2 ? 0 : 5, bottom: lift),
            child: Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                color: AppColors.textTertiary.withValues(alpha: 0.4 + lift / 8),
                shape: BoxShape.circle,
              ),
            ),
          );
        }),
      ),
    );
  }
}