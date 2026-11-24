import 'package:flutter/material.dart';
import '../../../core/icons/sw_icon.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';

/// One row of the change-picture sheet.
class SheetOption extends StatelessWidget {
  const SheetOption({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final SwIcon icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: Insets.lg,
          vertical: Insets.md,
        ),
        child: Row(
          children: [
            SwIconView(icon, size: 20, color: AppColors.textPrimary),
            const SizedBox(width: Insets.md),
            Text(label, style: AppText.bodyStrong),
          ],
        ),
      ),
    );
  }
}