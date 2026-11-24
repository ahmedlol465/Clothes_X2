import 'package:flutter/material.dart';

import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/models.dart';

/// What a picker sheet resolves to: either the chosen garment, a request to
/// empty the slot, or `null` when the sheet was simply dismissed.
typedef _SlotPick = ({bool clear, ClothingItem? item});

/// Frame 15 - build an outfit slot by slot from the real wardrobe.
///
/// Items come from `GET /wardrobe/items` via [AppState] — the same list the
/// Wardrobe tab shows — and are persisted with `POST /outfits` through
/// [AppState.createOutfit]. Slot filtering uses the backend's own category
/// vocabulary (`Tops / Bottoms / Shoes / Outerwear / Accessories`), never a
/// new taxonomy. This screen is the manual "Create Outfit" path only; AI
/// recommendations stay on Home until the user explicitly saves one.
class CreateOutfitScreen extends StatefulWidget {
  const CreateOutfitScreen({super.key});

  @override
  State<CreateOutfitScreen> createState() => _CreateOutfitScreenState();
}

class _CreateOutfitScreenState extends State<CreateOutfitScreen> {
  final _state = AppState.instance;
  final _name = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  /// Slot label → the garment picked for it. Saved in [_slots] order, so the
  /// request reads top → bottom → shoes → accessory.
  final _selected = <String, ClothingItem>{};

  String _tone = 'Casual';
  bool _saving = false;
  bool _slotError = false;
  String? _saveError;

  static const _tones = [
    'Casual',
    'Formal',
    'Summer',
    'Date Night',
    'University',
    'Winter',
  ];

  /// Slot label, placeholder hint and the `ClothingItem.category` values it
  /// accepts — the same strings `GET /wardrobe/items` returns in
  /// `categories`. TOP also accepts Outerwear so jackets and blazers still
  /// have a home in the four-slot layout.
  static const _slots = <(String, String, List<String>)>[
    ('TOP', 'Choose a top or jacket', ['Tops', 'Outerwear']),
    ('BOTTOM', 'Choose bottoms', ['Bottoms']),
    ('SHOES', 'Choose shoes', ['Shoes']),
    ('ACCESSORIES', 'Choose an accessory', ['Accessories']),
  ];

  @override
  void initState() {
    super.initState();
    // Defer the first load until after the first frame: loadWardrobe()
    // notifies listeners synchronously and initState runs during the build
    // phase (same reason as WardrobeScreen).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _state.loadWardrobe();
    });
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SwScreen(
      scroll: true,
      padding: const EdgeInsets.only(bottom: Insets.xxl),
      child: ListenableBuilder(
        listenable: _state,
        builder: (context, _) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SwAppBar(title: 'Create Your Outfit'),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Form(
                      key: _formKey,
                      child: SwField(
                        label: 'OUTFIT NAME',
                        controller: _name,
                        hint: 'e.g. Friday coffee run',
                        textInputAction: TextInputAction.done,
                        validator: (v) => (v == null || v.trim().isEmpty)
                            ? 'Give your outfit a name.'
                            : null,
                      ),
                    ),
                    const SizedBox(height: Insets.xl),
                    Text(
                      'OUTFIT PIECES',
                      style: AppText.overline.copyWith(
                        color: AppColors.primary,
                        letterSpacing: 1.1,
                      ),
                    ),
                    const SizedBox(height: Insets.md),
                    _buildPieces(),
                    const SizedBox(height: Insets.xl),
                    Text(
                      'STYLE TONE INSPIRATION',
                      style: AppText.overline.copyWith(
                        color: AppColors.primary,
                        letterSpacing: 1.1,
                      ),
                    ),
                    const SizedBox(height: Insets.md),
                    Wrap(
                      spacing: Insets.sm,
                      runSpacing: Insets.sm,
                      children: [
                        for (final tone in _tones)
                          SwChip(
                            label: tone,
                            selected: tone == _tone,
                            onTap: () => setState(() => _tone = tone),
                          ),
                      ],
                    ),
                    const SizedBox(height: Insets.xxxl),
                    SwOutlineButton(
                      label: 'Get AI Suggestions',
                      foreground: AppColors.primary,
                      onTap: () => ScaffoldMessenger.of(context)
                        ..hideCurrentSnackBar()
                        ..showSnackBar(
                          SnackBar(content: Text('$_tone looks coming up.')),
                        ),
                    ),
                    const SizedBox(height: Insets.md),
                    if (_saveError != null) ...[
                      SwBanner(
                        tone: SwBannerTone.warning,
                        message: _saveError!,
                      ),
                      const SizedBox(height: Insets.md),
                    ],
                    SwButton(
                      label: 'Save Outfit',
                      busy: _saving,
                      onTap: _saving ? null : _save,
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  /// The four slot rows in their loading / empty / error / ready variants.
  Widget _buildPieces() {
    if (_state.wardrobeLoading && _state.wardrobe.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.symmetric(vertical: Insets.xl),
          child: SizedBox(
            width: 24,
            height: 24,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      );
    }

    if (_state.wardrobe.isEmpty) {
      final failed = _state.lastError != null;
      return SwCard(
        padding: const EdgeInsets.all(Insets.lg),
        child: Column(
          children: [
            SwIconBadge(
              icon: failed ? SwIcon.alert : SwIcon.shirt,
              circle: true,
              size: 44,
            ),
            const SizedBox(height: Insets.md),
            Text(
              failed ? "Couldn't load your wardrobe" : 'No wardrobe items yet',
              textAlign: TextAlign.center,
              style: AppText.cardTitle,
            ),
            const SizedBox(height: Insets.xs),
            Text(
              // The real API error, never an invented reason.
              failed
                  ? _state.lastError!
                  : 'Add clothes to your wardrobe, then come back to build an outfit.',
              textAlign: TextAlign.center,
              style: AppText.caption,
            ),
            const SizedBox(height: Insets.lg),
            SwOutlineButton(
              label: failed ? 'Retry' : 'Refresh',
              expand: false,
              onTap: () => _state.loadWardrobe(),
            ),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < _slots.length; i++) ...[
          _SlotRow(
            label: _slots[i].$1,
            hint: _slots[i].$2,
            item: _selected[_slots[i].$1],
            onTap: () => _pickSlot(_slots[i]),
          ),
          if (i != _slots.length - 1) const SizedBox(height: Insets.md),
        ],
        if (_slotError && _selected.isEmpty) ...[
          const SizedBox(height: Insets.sm),
          Text(
            'Pick at least one item for your outfit.',
            style: AppText.caption.copyWith(color: AppColors.danger),
          ),
        ],
      ],
    );
  }

  /// Opens the item picker for one slot, filtered to that slot's categories.
  Future<void> _pickSlot((String, String, List<String>) slot) async {
    final (label, _, categories) = slot;
    final candidates = [
      for (final item in _state.wardrobe)
        if (categories.contains(item.category)) item,
    ];
    final result = await showModalBottomSheet<_SlotPick>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      builder: (_) => _ItemPickerSheet(
        slot: label,
        items: candidates,
        selected: _selected[label],
      ),
    );
    if (result == null || !mounted) return;
    setState(() {
      if (result.clear) {
        _selected.remove(label);
      } else if (result.item != null) {
        _selected[label] = result.item!;
        _slotError = false;
      }
      _saveError = null;
    });
  }

  /// Validates the name (via the [Form]) and the slot selection, then saves
  /// through [AppState.createOutfit] and pops back to the Outfits screen.
  Future<void> _save() async {
    if (_saving) return;
    final nameOk = _formKey.currentState?.validate() ?? false;
    final hasItems = _selected.isNotEmpty;
    setState(() {
      _slotError = !hasItems;
      _saveError = null;
    });
    if (!nameOk || !hasItems) return;

    setState(() => _saving = true);
    final result = await _state.createOutfit(
      name: _name.text.trim(),
      itemIds: [
        for (final slot in _slots)
          if (_selected[slot.$1] != null) _selected[slot.$1]!.id,
      ],
      occasion: _tone,
    );
    if (!mounted) return;
    setState(() => _saving = false);
    switch (result) {
      case SaveOutfitResult.saved:
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(const SnackBar(content: Text('Outfit saved.')));
        Navigator.of(context).pop();
      case SaveOutfitResult.duplicate:
        setState(() {
          _saveError = 'That outfit is already in your saved outfits.';
        });
      case SaveOutfitResult.failed:
        setState(() {
          _saveError = _state.lastError ?? 'Backend offline — try again shortly.';
        });
    }
  }
}

/// One outfit slot: the picked garment's thumbnail (or a plus sign), the
/// slot label and the item name or its placeholder hint.
class _SlotRow extends StatelessWidget {
  const _SlotRow({
    required this.label,
    required this.hint,
    required this.item,
    required this.onTap,
  });

  final String label;
  final String hint;
  final ClothingItem? item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final image = item?.image ?? '';
    final empty = image.isEmpty;

    return SwCard(
      onTap: onTap,
      padding: const EdgeInsets.all(Insets.md),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              color: AppColors.background,
              borderRadius: Radii.tileRadius,
            ),
            child: empty
                ? const Center(
                    child: SwIconView(
                      SwIcon.plus,
                      size: 18,
                      color: AppColors.textSecondary,
                    ),
                  )
                : SwPhoto(path: image),
          ),
          const SizedBox(width: Insets.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: AppText.overline.copyWith(fontSize: 9)),
                const SizedBox(height: 3),
                Text(
                  item?.name ?? hint,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.bodyStrong.copyWith(
                    color: item == null
                        ? AppColors.textTertiary
                        : AppColors.textPrimary,
                  ),
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

/// Bottom sheet listing the wardrobe items valid for one slot.
///
/// Pops `(clear: true, item: null)` when the slot should be emptied,
/// `(clear: false, item: picked)` when an item is chosen, and `null` when the
/// sheet is dismissed without a decision.
class _ItemPickerSheet extends StatelessWidget {
  const _ItemPickerSheet({
    required this.slot,
    required this.items,
    required this.selected,
  });

  final String slot;
  final List<ClothingItem> items;
  final ClothingItem? selected;

  static String _titleFor(String slot) =>
      'Choose ${slot[0]}${slot.substring(1).toLowerCase()}';

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.6,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            Insets.lg,
            Insets.lg,
            Insets.lg,
            0,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text(_titleFor(slot), style: AppText.h4)),
                  SwIconButton(
                    icon: SwIconButtonKind.close,
                    onTap: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
              if (selected != null) ...[
                const SizedBox(height: Insets.sm),
                GestureDetector(
                  onTap: () =>
                      Navigator.of(context).pop((clear: true, item: null)),
                  child: Text(
                    'Clear this slot',
                    style: AppText.label.copyWith(color: AppColors.primary),
                  ),
                ),
              ],
              const SizedBox(height: Insets.md),
              Expanded(
                child: items.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const SwIconBadge(
                              icon: SwIcon.shirt,
                              circle: true,
                              size: 44,
                            ),
                            const SizedBox(height: Insets.md),
                            Text(
                              'No items in this category yet',
                              style: AppText.cardTitle,
                            ),
                            const SizedBox(height: Insets.xs),
                            Text(
                              'Add some in the Wardrobe tab.',
                              textAlign: TextAlign.center,
                              style: AppText.caption,
                            ),
                          ],
                        ),
                      )
                    : ListView.separated(
                        physics: const BouncingScrollPhysics(),
                        itemCount: items.length,
                        separatorBuilder: (_, _) =>
                            const SizedBox(height: Insets.sm),
                        itemBuilder: (context, i) {
                          final item = items[i];
                          final picked = selected?.id == item.id;
                          return SwCard(
                            onTap: () => Navigator.of(context)
                                .pop((clear: false, item: item)),
                            padding: const EdgeInsets.all(Insets.md),
                            child: Row(
                              children: [
                                SwProductImage(
                                  image: item.image,
                                  width: 56,
                                  height: 56,
                                ),
                                const SizedBox(width: Insets.md),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        item.name,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: AppText.cardTitle,
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        item.meta,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: AppText.caption,
                                      ),
                                    ],
                                  ),
                                ),
                                SwIconView(
                                  picked
                                      ? SwIcon.check
                                      : SwIcon.chevronRight,
                                  size: 16,
                                  color: picked
                                      ? AppColors.primary
                                      : AppColors.textTertiary,
                                ),
                              ],
                            ),
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
