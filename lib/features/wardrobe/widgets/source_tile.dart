import 'package:flutter/material.dart';

import 'package:smartwardrobe/core/icons/sw_icon.dart';
import 'package:smartwardrobe/core/theme/app_colors.dart';
import 'package:smartwardrobe/core/theme/app_spacing.dart';
import 'package:smartwardrobe/core/theme/app_typography.dart';
import 'package:smartwardrobe/core/widgets/sw_widgets.dart';

class SourceTile extends StatelessWidget {
  const SourceTile({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final SwIcon icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return SwCard(
      onTap: onTap,
      padding: const EdgeInsets.all(Insets.lg),
      child: Row(
        children: [
          SwIconBadge(icon: icon, size: 44, iconSize: 20),
          const SizedBox(width: Insets.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppText.cardTitle),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.caption,
                ),
              ],
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