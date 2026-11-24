import 'package:flutter/material.dart';

import 'package:smartwardrobe/core/icons/sw_icon.dart';
import 'package:smartwardrobe/core/theme/app_colors.dart';
import 'package:smartwardrobe/core/theme/app_spacing.dart';
import 'package:smartwardrobe/core/theme/app_typography.dart';
import 'package:smartwardrobe/core/widgets/sw_widgets.dart';

class DiscoverLink extends StatelessWidget {
  const DiscoverLink({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SwCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(
        horizontal: Insets.md,
        vertical: Insets.sm,
      ),
      child: Row(
        children: [
          const SwIconBadge(icon: SwIcon.sparkleCircle, size: 30, iconSize: 16),
          const SizedBox(width: Insets.md),
          Expanded(
            child: Text(
              'Discover trending styles & inspiration',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppText.bodyStrong.copyWith(fontSize: 13),
            ),
          ),
          const SwIconView(
            SwIcon.chevronRight,
            size: 16,
            color: AppColors.textTertiary,
          ),
        ],
      ),
    );
  }
}