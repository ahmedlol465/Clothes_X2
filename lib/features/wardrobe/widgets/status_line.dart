import 'package:flutter/material.dart';

import 'package:smartwardrobe/core/icons/sw_icon.dart';
import 'package:smartwardrobe/core/theme/app_colors.dart';
import 'package:smartwardrobe/core/theme/app_spacing.dart';
import 'package:smartwardrobe/core/theme/app_typography.dart';
import '../add_clothing_shared.dart';

class StatusLine extends StatelessWidget {
  const StatusLine({super.key, required this.photos});

  final List<Staged> photos;

  @override
  Widget build(BuildContext context) {
    Widget leading;
    String text;
    final staging =
        photos.where((p) => p.phase == Phase.staging).length;
    final saving = photos.where((p) => p.phase == Phase.saving).length;
    final errors = photos.where((p) => p.phase == Phase.error).length;
    final ready = photos.where((p) => p.phase == Phase.ready).length;
    if (staging > 0) {
      leading = const SizedBox.square(
        dimension: 20,
        child: CircularProgressIndicator(strokeWidth: 2),
      );
      text = 'AI is analyzing your clothing'
          '${photos.length > 1 ? ' ($ready/${photos.length})' : ''}…';
    } else if (saving > 0) {
      leading = const SizedBox.square(
        dimension: 20,
        child: CircularProgressIndicator(strokeWidth: 2),
      );
      text = 'Saving to your wardrobe…';
    } else if (errors > 0 && ready == 0) {
      leading = const SwIconView(
        SwIcon.refresh,
        size: 20,
        color: AppColors.danger,
      );
      String? firstError;
      for (final p in photos) {
        if (p.phase == Phase.error && (p.error?.isNotEmpty ?? false)) {
          firstError = p.error;
          break;
        }
      }
      text = firstError ?? 'Analysis failed — tap a photo to retry.';
    } else if (ready > 0) {
      final vision =
          photos.any((p) => p.phase == Phase.ready && p.source != 'heuristic');
      leading = const SwIconView(
        SwIcon.check,
        size: 20,
        color: AppColors.success,
      );
      text = vision
          ? 'AI vision analysis complete — review the tags.'
          : 'Analysis complete (offline heuristics) — review the tags.';
      if (errors > 0) {
        text += ' $errors photo${errors == 1 ? '' : 's'} rejected.';
      }
    } else {
      return const SizedBox.shrink();
    }
    return Row(
      children: [
        leading,
        const SizedBox(width: Insets.md),
        Expanded(
          child: Text(
            text,
            style: AppText.bodyStrong.copyWith(fontSize: 13),
          ),
        ),
      ],
    );
  }
}