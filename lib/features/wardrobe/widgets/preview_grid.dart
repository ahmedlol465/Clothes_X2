import 'package:flutter/material.dart';

import 'package:smartwardrobe/core/icons/sw_icon.dart';
import 'package:smartwardrobe/core/theme/app_colors.dart';
import 'package:smartwardrobe/core/theme/app_spacing.dart';
import 'package:smartwardrobe/core/theme/app_typography.dart';
import '../add_clothing_shared.dart';

class PreviewGrid extends StatelessWidget {
  const PreviewGrid({
    super.key,
    required this.photos,
    required this.onRemove,
    required this.onRetry,
  });

  final List<Staged> photos;
  final void Function(int index) onRemove;
  final void Function(int index) onRetry;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        mainAxisSpacing: Insets.sm,
        crossAxisSpacing: Insets.sm,
      ),
      itemCount: photos.length,
      itemBuilder: (context, i) {
        final p = photos[i];
        return Stack(
          fit: StackFit.expand,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(Radii.md),
              child: p.bytes.isEmpty
                  ? const ColoredBox(color: AppColors.tint)
                  : Image.memory(p.bytes, fit: BoxFit.cover),
            ),
            if (p.phase == Phase.staging || p.phase == Phase.saving)
              Container(
                decoration: BoxDecoration(
                  color: AppColors.scrim,
                  borderRadius: BorderRadius.circular(Radii.md),
                ),
                child: const Center(
                  child: SizedBox.square(
                    dimension: 22,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              ),
            if (p.phase == Phase.ready)
              Positioned(
                left: 6,
                bottom: 6,
                right: 6,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.scrim,
                    borderRadius: BorderRadius.circular(Radii.sm),
                  ),
                  child: Text(
                    '${tagValue(p.analysis, 'COLOR')} ${tagValue(p.analysis, 'CATEGORY')}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.overline.copyWith(
                      fontSize: 9,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            if (p.phase == Phase.error)
              Positioned.fill(
                child: GestureDetector(
                  onTap: () => onRetry(i),
                  child: Container(
                    decoration: BoxDecoration(
                      color: AppColors.scrim,
                      borderRadius: BorderRadius.circular(Radii.md),
                    ),
                    child: const Center(
                      child: SwIconView(
                        SwIcon.refresh,
                        size: 22,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
              ),
            Positioned(
              top: 2,
              right: 2,
              child: GestureDetector(
                onTap: () => onRemove(i),
                child: Container(
                  padding: const EdgeInsets.all(4),
                  decoration: const BoxDecoration(
                    color: AppColors.scrim,
                    shape: BoxShape.circle,
                  ),
                  child: const SwIconView(
                    SwIcon.close,
                    size: 12,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}