import 'package:flutter/material.dart';
import '../../../core/icons/sw_icon.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';

class SettingRow extends StatelessWidget {
  const SettingRow({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    this.onTap,
  });

  final SwIcon icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(Insets.lg),
        child: Row(
          children: [
            SwIconView(icon, size: 18, color: AppColors.primary),
            const SizedBox(width: Insets.lg),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: AppText.bodyStrong.copyWith(fontSize: 14)),
                  const SizedBox(height: 1),
                  Text(subtitle, style: AppText.caption),
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
      ),
    );
  }
}