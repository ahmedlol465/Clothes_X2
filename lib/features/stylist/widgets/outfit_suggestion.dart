import 'package:flutter/material.dart';

import 'package:smartwardrobe/app.dart';
import 'package:smartwardrobe/core/theme/app_spacing.dart';
import 'package:smartwardrobe/core/theme/app_typography.dart';
import 'package:smartwardrobe/core/widgets/sw_widgets.dart';
import 'package:smartwardrobe/data/app_state.dart';
import 'package:smartwardrobe/data/controllers/outfits_controller.dart';
import 'package:smartwardrobe/data/models.dart';

class OutfitSuggestion extends StatefulWidget {
  OutfitSuggestion._({
    required Outfit outfit,
    OutfitsController? outfitsController,
  })  : _outfit = outfit,
        _outfitsController = outfitsController ?? AppState.instance.outfitsController;

  factory OutfitSuggestion({
    Key? key,
    required Outfit outfit,
    OutfitsController? outfitsController,
  }) {
    return OutfitSuggestion._(
      outfit: outfit,
      outfitsController: outfitsController,
    );
  }

  final Outfit _outfit;
  final OutfitsController _outfitsController;

  @override
  State<OutfitSuggestion> createState() => _OutfitSuggestionState();
}

class _OutfitSuggestionState extends State<OutfitSuggestion> {
  static const List<String> _variants = [
    'casual',
    'cold',
    'summer',
    'date',
    'formal',
  ];
  static const Map<String, String> _labels = {
    'casual': 'Casual',
    'cold': 'Colder',
    'summer': 'Summer',
    'date': 'Date',
    'formal': 'Formal',
  };

  String? _busy;
  Outfit? _remixed;

  bool get _remixable =>
      (widget._outfit.itemIds ?? const <String>[]).length >= 2;

  Future<void> _runRemix(String variant) async {
    if (_busy != null) return;
    setState(() => _busy = variant);
    final result = await widget._outfitsController.remix(
      widget._outfit.itemIds ?? const <String>[],
      variant,
    );
    if (!mounted) return;
    setState(() {
      _busy = null;
      if (result != null) _remixed = result;
    });
  }

  @override
  Widget build(BuildContext context) {
    final outfit = _remixed ?? widget._outfit;
    final isRemix = _remixed != null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SwCard(
          padding: EdgeInsets.zero,
          clip: true,
          onTap: () => Navigator.of(context).pushNamed(
                Routes.perfectMatch,
                arguments: outfit,
              ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                height: 130,
                width: double.infinity,
                child: SwPhoto(path: outfit.image),
              ),
              Padding(
                padding: const EdgeInsets.all(Insets.md),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(outfit.name, style: AppText.cardTitle),
                          const SizedBox(height: 2),
                          Text(
                            outfit.summary ?? outfit.pieces.join(' + '),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppText.caption,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: Insets.sm),
                    SwMatchBadge(match: outfit.match),
                  ],
                ),
              ),
              if (outfit.note != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    Insets.md,
                    0,
                    Insets.md,
                    Insets.sm,
                  ),
                  child: Text(outfit.note!, style: AppText.caption),
                ),
              if (outfit.explanation != null && isRemix)
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    Insets.md,
                    0,
                    Insets.md,
                    Insets.sm,
                  ),
                  child: Text(outfit.explanation!, style: AppText.caption),
                ),
            ],
          ),
        ),
        if (_remixable) ...[
          const SizedBox(height: Insets.sm),
          SizedBox(
            height: 28,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              physics: const BouncingScrollPhysics(),
              itemCount: _variants.length,
              separatorBuilder: (_, _) => const SizedBox(width: 6),
              itemBuilder: (context, i) {
                final v = _variants[i];
                final active = _busy == v;
                return SwChip(
                  label: active ? '…' : _labels[v]!,
                  dense: true,
                  selected: _remixed?.variant == v,
                  onTap: _busy == null ? () => _runRemix(v) : null,
                );
              },
            ),
          ),
        ],
      ],
    );
  }
}