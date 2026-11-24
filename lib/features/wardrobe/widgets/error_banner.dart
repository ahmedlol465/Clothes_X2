import 'package:flutter/material.dart';

import 'package:smartwardrobe/core/theme/app_colors.dart';
import 'package:smartwardrobe/core/theme/app_spacing.dart';
import 'package:smartwardrobe/core/theme/app_typography.dart';

class ErrorBanner extends StatelessWidget {
  const ErrorBanner({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final offline = message.contains('unreachable') ||
        message.contains('Backend offline') ||
        message.contains('timed out');
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: Insets.lg),
      padding: const EdgeInsets.all(Insets.md),
      decoration: BoxDecoration(
        color: AppColors.dangerSurface,
        borderRadius: BorderRadius.circular(Radii.md),
      ),
      child: Text(
        offline
            ? 'Backend unreachable — run `npm start` in backend/ (or set API_BASE_URL to your PC\'s LAN IP when testing from a phone), then retry.'
            : message,
        style: AppText.caption,
      ),
    );
  }
}