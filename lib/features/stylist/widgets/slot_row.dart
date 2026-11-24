import 'package:flutter/material.dart';

import 'package:smartwardrobe/core/theme/app_colors.dart';
import 'package:smartwardrobe/core/theme/app_spacing.dart';
import 'package:smartwardrobe/core/theme/app_typography.dart';
import 'package:smartwardrobe/core/widgets/sw_widgets.dart';
import 'package:smartwardrobe/data/models.dart';

class SlotRow extends StatelessWidget {
  const SlotRow({super.key, required this.slot});

  final SlotMatch slot;

  @override
  Widget build(BuildContext context) {
    final filled = slot.itemName.isNotEmpty;
    return Row(
      children: [
        SizedBox(
          width: 34,
          height: 34,
          child: filled
              ? SwProductImage(image: slot.image, radius: Radii.sm)
              : Container(
                  decoration: BoxDecoration(
                    color: AppColors.iconTint,
                    borderRadius: Radii.smRadius,
                  ),
                  child: const Icon(
                    Icons.add,
                    size: 16,
                    color: AppColors.textTertiary,
                  ),
                ),
        ),
        const SizedBox(width: Insets.sm),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                filled ? slot.itemName : 'No ${slot.slotLabel.toLowerCase()}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppText.body.copyWith(fontSize: 13),
              ),
              Text(
                filled
                    ? '${slot.slotLabel} · asked for ${slot.requestedGarment}'
                    : slot.reason,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: AppText.caption,
              ),
            ],
          ),
        ),
        if (filled)
          Text(
            '${slot.score}%',
            style: AppText.bodyStrong.copyWith(fontSize: 12),
          ),
      ],
    );
  }
}