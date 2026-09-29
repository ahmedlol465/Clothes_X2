import 'package:flutter/material.dart';

import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/mock_data.dart';
import '../../data/models.dart';

/// Frame 11 - full detail view for a single garment.
///
/// Edit / Wear / Delete are wired to the backend wardrobe API (§8.3).
class ItemDetailScreen extends StatefulWidget {
  const ItemDetailScreen({super.key, required this.item});

  final ClothingItem item;

  @override
  State<ItemDetailScreen> createState() => _ItemDetailScreenState();
}

class _ItemDetailScreenState extends State<ItemDetailScreen> {
  late ClothingItem _item = widget.item;
  bool _busy = false;

  Future<void> _wear() async {
    if (_busy) return;
    setState(() => _busy = true);
    final ok = await AppState.instance.logWear(_item);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _item = _item.copyWith(
        timesWorn: _item.timesWorn + 1,
        lastWornLabel: 'Worn today',
      );
    });
    _toast(
      context,
      ok ? 'Logged — enjoy the ${_item.name}.' : 'Backend offline — logged locally.',
    );
  }

  Future<void> _edit() async {
    final patch = await showModalBottomSheet<Map<String, String>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      builder: (sheetContext) => _EditSheet(item: _item),
    );
    if (patch == null || !mounted) return;
    final ok = await AppState.instance.updateItem(_item.id, patch);
    if (!mounted) return;
    if (ok) {
      setState(() {
        _item = _item.copyWith(
          name: patch['name'],
          category: patch['category'],
          color: patch['color'],
          style: patch['style'],
          material: patch['material'],
          season: patch['season'],
          formality: patch['formality'],
        );
      });
    }
    _toast(
      context,
      ok ? 'Saved changes.' : 'Backend offline — try again shortly.',
    );
  }

  Future<void> _delete() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove item?'),
        content: Text('${_item.name} will be archived.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    final ok = await AppState.instance.deleteItem(_item.id);
    if (!mounted) return;
    Navigator.of(context).pop();
    _toast(
      context,
      ok ? 'Item removed.' : 'Backend offline — try again shortly.',
    );
  }

  @override
  Widget build(BuildContext context) {
    final item = _item;
    final rows = <(SwIcon, String, String)>[
      (SwIcon.circleX, 'Category', item.category),
      (SwIcon.palette, 'Color', item.color),
      (SwIcon.sparkle, 'Style', item.style),
      (SwIcon.box, 'Material', item.material),
      (SwIcon.sun, 'Season', item.season),
      (SwIcon.tag, 'Formality', item.formality),
    ];

    return SwScreen(
      scroll: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Hero(
            image: item.image,
            onBack: () => Navigator.of(context).pop(),
            onMore: _delete,
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              Insets.gutter,
              Insets.xl,
              Insets.gutter,
              Insets.xxl,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item.name, style: AppText.h1.copyWith(fontSize: 24)),
                const SizedBox(height: Insets.md),
                Wrap(
                  spacing: Insets.sm,
                  runSpacing: Insets.sm,
                  children: [
                    for (final tag in [
                      item.category,
                      item.color,
                      item.style,
                      item.material.split(' ').first,
                    ])
                      SwChip(label: tag, dense: true),
                  ],
                ),
                const SizedBox(height: Insets.lg),
                for (final (icon, label, value) in rows) ...[
                  _AttributeRow(icon: icon, label: label, value: value),
                  const SizedBox(height: Insets.sm),
                ],
                const SizedBox(height: Insets.lg),
                _UsageStats(item: item),
                const SizedBox(height: Insets.lg),
                Row(
                  children: [
                    Expanded(
                      child: SwOutlineButton(
                        label: 'Edit',
                        onTap: _edit,
                      ),
                    ),
                    const SizedBox(width: Insets.md),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: _busy ? null : _wear,
                        icon: const SwIconView(
                          SwIcon.check,
                          size: 15,
                          color: Colors.white,
                        ),
                        label: const Text('Wear'),
                        style: FilledButton.styleFrom(
                          minimumSize: const Size.fromHeight(
                            Sizes.buttonHeight,
                          ),
                          textStyle: AppText.button,
                          shape: const RoundedRectangleBorder(
                            borderRadius: Radii.pillRadius,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Bottom sheet with editable attribute fields.
class _EditSheet extends StatefulWidget {
  const _EditSheet({required this.item});

  final ClothingItem item;

  @override
  State<_EditSheet> createState() => _EditSheetState();
}

class _EditSheetState extends State<_EditSheet> {
  late final _controllers = <String, TextEditingController>{
    'name': TextEditingController(text: widget.item.name),
    'category': TextEditingController(text: widget.item.category),
    'color': TextEditingController(text: widget.item.color),
    'style': TextEditingController(text: widget.item.style),
    'material': TextEditingController(text: widget.item.material),
    'season': TextEditingController(text: widget.item.season),
    'formality': TextEditingController(text: widget.item.formality),
  };

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: Insets.xl,
        right: Insets.xl,
        top: Insets.xl,
        bottom: MediaQuery.of(context).viewInsets.bottom + Insets.xl,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Edit item', style: AppText.h4),
            const SizedBox(height: Insets.lg),
            for (final entry in _controllers.entries) ...[
              SwField(label: entry.key, controller: entry.value),
              const SizedBox(height: Insets.md),
            ],
            const SizedBox(height: Insets.md),
            SwButton(
              label: 'Save changes',
              onTap: () => Navigator.of(context).pop(
                {for (final e in _controllers.entries) e.key: e.value.text},
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Edge to edge product photo with floating back and overflow actions.
class _Hero extends StatelessWidget {
  const _Hero({
    required this.image,
    required this.onBack,
    required this.onMore,
  });

  final String image;
  final VoidCallback onBack;
  final VoidCallback onMore;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 380,
      child: Stack(
        fit: StackFit.expand,
        children: [
          Image.asset(image, fit: BoxFit.cover),
          Positioned(
            top: Insets.md,
            left: Insets.lg,
            child: SwIconButton(
              icon: SwIconButtonKind.back,
              onTap: onBack,
              background: Colors.white.withValues(alpha: 0.9),
            ),
          ),
          Positioned(
            top: Insets.md,
            right: Insets.lg,
            child: SwIconButton(
              icon: SwIconButtonKind.more,
              onTap: onMore,
              background: Colors.white.withValues(alpha: 0.9),
            ),
          ),
        ],
      ),
    );
  }
}

class _AttributeRow extends StatelessWidget {
  const _AttributeRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final SwIcon icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: Insets.lg,
        vertical: Insets.lg,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: Radii.cardRadius,
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          SwIconView(icon, size: 17, color: AppColors.textSecondary),
          const SizedBox(width: Insets.md),
          Expanded(child: Text(label, style: AppText.body)),
          Text(value, style: AppText.bodyStrong),
        ],
      ),
    );
  }
}

/// Two usage statistics shown at the bottom of the detail screen.
class _UsageStats extends StatelessWidget {
  const _UsageStats({required this.item});

  final ClothingItem item;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: SwCard(
            padding: const EdgeInsets.all(Insets.md),
            child: Row(
              children: [
                const SwIconView(
                  SwIcon.layers,
                  size: 18,
                  color: AppColors.primary,
                ),
                const SizedBox(width: Insets.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Used in ${item.timesWorn ~/ 4} outfits',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.labelStrong.copyWith(fontSize: 11),
                      ),
                      Text('Versatile piece', style: AppText.caption),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: Insets.md),
        Expanded(
          child: SwCard(
            padding: const EdgeInsets.all(Insets.md),
            child: Row(
              children: [
                const SwIconView(
                  SwIcon.calendar,
                  size: 18,
                  color: AppColors.primary,
                ),
                const SizedBox(width: Insets.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.lastWornLabel ?? 'Recently worn',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.labelStrong.copyWith(fontSize: 11),
                      ),
                      Text('Regular rotation', style: AppText.caption),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

void _toast(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

/// Convenience constructor used by lists that always show the sample shirt.
ItemDetailScreen sample() => ItemDetailScreen(item: MockData.wardrobe.first);
