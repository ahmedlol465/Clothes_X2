import 'package:flutter/material.dart';

import 'package:smartwardrobe/app.dart';
import 'package:smartwardrobe/core/theme/app_spacing.dart';
import 'package:smartwardrobe/core/theme/app_typography.dart';
import 'package:smartwardrobe/core/widgets/sw_widgets.dart';
import 'package:smartwardrobe/data/models.dart';
import 'slot_row.dart';

class MatchResultCard extends StatelessWidget {
  const MatchResultCard({super.key, required this.match});

  final OutfitMatch match;

  @override
  Widget build(BuildContext context) {
    return SwCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Style Match', style: AppText.overline),
                    const SizedBox(height: 4),
                    Text(match.title, style: AppText.cardTitle),
                  ],
                ),
              ),
              SwMatchBadge(match: match.similarity),
            ],
          ),
          const SizedBox(height: Insets.sm),
          Text(
            match.wearable
                ? 'Wearable with what you own — ${match.exactCount} piece'
                    '${match.exactCount == 1 ? '' : 's'} matched exactly.'
                : 'Partial match — fill the gaps below to wear this look.',
            style: AppText.caption,
          ),
          const SizedBox(height: Insets.md),
          for (final slot in match.matches) ...[
            SlotRow(slot: slot),
            const SizedBox(height: Insets.sm),
          ],
          if (match.gaps.isNotEmpty) ...[
            const SizedBox(height: Insets.xs),
            Text('You are missing', style: AppText.bodyStrong.copyWith(fontSize: 13)),
            const SizedBox(height: Insets.sm),
            for (final gap in match.gaps)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text('• ${gap.slotLabel}: ${gap.missing}',
                    style: AppText.caption),
              ),
          ],
          if (match.outfit != null) ...[
            const SizedBox(height: Insets.md),
            SwButton(
              label: 'See full breakdown',
              onTap: () => Navigator.of(context).pushNamed(
                Routes.perfectMatch,
                arguments: match.outfit,
              ),
            ),
          ],
        ],
      ),
    );
  }
}