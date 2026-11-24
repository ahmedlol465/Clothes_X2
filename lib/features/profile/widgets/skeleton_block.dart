import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';

/// Shimmer-free neutral placeholder block for the loading state.
class SkeletonBlock extends StatelessWidget {
  const SkeletonBlock({super.key, required this.height});

  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: Radii.cardRadius,
        border: Border.all(color: AppColors.border),
      ),
      child: const Center(
        child: SizedBox.square(
          dimension: 22,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      ),
    );
  }
}