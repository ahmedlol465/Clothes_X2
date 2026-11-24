import 'package:flutter/material.dart';
import '../../../core/icons/sw_icon.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/sw_widgets.dart';
import 'skeleton_block.dart';

/// Loading skeleton and error card shown in place of the profile blocks.
class ProfilePlaceholder extends StatelessWidget {
  const ProfilePlaceholder({
    super.key,
    required this.loading,
    required this.message,
    required this.onRetry,
  });

  final bool loading;
  final String? message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: const [
          SkeletonBlock(height: 92),
          SizedBox(height: Insets.lg),
          SkeletonBlock(height: 280),
        ],
      );
    }

    return SwCard(
      padding: const EdgeInsets.all(Insets.xl),
      child: Column(
        children: [
          const SwIconBadge(icon: SwIcon.alert, circle: true, size: 48),
          const SizedBox(height: Insets.lg),
          Text("Couldn't load your profile", style: AppText.h4),
          const SizedBox(height: Insets.sm),
          Text(
            message ?? 'Something went wrong. Please try again.',
            textAlign: TextAlign.center,
            style: AppText.body,
          ),
          const SizedBox(height: Insets.xl),
          SwButton(label: 'Retry', onTap: onRetry),
        ],
      ),
    );
  }
}