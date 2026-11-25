import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/assets.dart';
import '../../data/controllers/shop_controller.dart';

/// Avatar Stylist: enter a budget and a few preferences and the app builds a
/// full outfit from real scraped brand products, layered on a mannequin.
///
/// Isolated feature: this folder plus one route entry and two navigation
/// rows. Deleting the folder and those entries removes the whole feature.
class OutfitStudioScreen extends StatefulWidget {
  const OutfitStudioScreen._(this._shopController);

  factory OutfitStudioScreen({Key? key, ShopController? shopController}) {
    return OutfitStudioScreen._(
      shopController ?? AppState.instance.shopController,
    );
  }

  final ShopController _shopController;

  @override
  State<OutfitStudioScreen> createState() => _OutfitStudioScreenState();
}

class _OutfitStudioScreenState extends State<OutfitStudioScreen> {
  final _budgetCtrl = TextEditingController(text: '3000');

  static const _occasions = ['casual', 'work', 'formal', 'party', 'date', 'sport'];
  static const _styles = ['any', 'casual', 'streetwear', 'minimalist', 'formal', 'sporty'];

  String _occasion = 'casual';
  String _style = 'any';
  String? _gender; // from the saved style profile
  bool _loading = false;
  String? _error;
  Map<String, dynamic>? _result;

  @override
  void initState() {
    super.initState();
    _loadGender();
  }

  Future<void> _loadGender() async {
    try {
      final user = await widget._shopController.api.currentUser();
      final g = (user['styleProfile'] as Map?)?['gender'];
      if (mounted && (g == 'male' || g == 'female')) {
        setState(() => _gender = g as String);
      }
    } catch (_) {
      // Gender stays unset; the builder just skips the gender filter.
    }
  }

  Future<void> _build({List<String> excludeIds = const []}) async {
    final budget = double.tryParse(_budgetCtrl.text.trim());
    if (budget == null || budget <= 0) {
      setState(() => _error = 'Enter a positive budget.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await widget._shopController.api.buildOutfitWithinBudget(
        budget,
        occasion: _occasion,
        style: _style == 'any' ? null : _style,
        gender: _gender,
        excludeIds: excludeIds,
      );
      if (!mounted) return;
      setState(() => _result = Map<String, dynamic>.from(res));
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not build an outfit. Try a different budget.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _swap(Map<String, dynamic> item) {
    final id = '${item['id']}';
    // Rebuild the whole look without this product; the greedy builder keeps
    // the other picks unless the budget math changes.
    _build(excludeIds: [id]);
  }

  Future<void> _openProduct(Map<String, dynamic> item) async {
    final url = '${item['productUrl'] ?? ''}';
    if (url.isEmpty) return;
    final uri = Uri.tryParse(url);
    if (uri != null && await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else {
      await Clipboard.setData(ClipboardData(text: url));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Product link copied.')),
        );
      }
    }
  }

  List<Map<String, dynamic>> get _items => [
        for (final raw in (_result?['items'] as List? ?? const []))
          Map<String, dynamic>.from(raw as Map),
      ];

  Map<String, dynamic>? _itemForSlot(String slot) {
    for (final item in _items) {
      if (item['slot'] == slot) return item;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return SwScreen(
      scroll: true,
      padding: const EdgeInsets.only(bottom: Insets.xxl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SwAppBar(title: 'Avatar Stylist'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _controls(),
                const SizedBox(height: Insets.lg),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: Insets.md),
                    child: Text(_error!, style: AppText.caption),
                  ),
                if (_result != null) ...[
                  _avatarPanel(),
                  const SizedBox(height: Insets.lg),
                  _summary(),
                  const SizedBox(height: Insets.lg),
                  for (final item in _items) ...[
                    _itemCard(item),
                    const SizedBox(height: Insets.md),
                  ],
                ] else if (!_loading)
                  Padding(
                    padding: const EdgeInsets.only(top: Insets.xl),
                    child: Text(
                      'Set a budget and tap "Build my outfit" - I will pick real pieces from Egyptian stores and dress the mannequin.',
                      style: AppText.caption,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _controls() {
    return SwCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _budgetCtrl,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Budget (EGP)',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
              ),
              const SizedBox(width: Insets.md),
              if (_gender != null)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: Insets.md,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.background,
                    borderRadius: Radii.pillRadius,
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Text(
                    _gender == 'male' ? 'Men' : 'Women',
                    style: AppText.label,
                  ),
                ),
            ],
          ),
          const SizedBox(height: Insets.md),
          Row(
            children: [
              Expanded(
                child: _dropdown(
                  label: 'Occasion',
                  value: _occasion,
                  options: _occasions,
                  onChanged: (v) => setState(() => _occasion = v),
                ),
              ),
              const SizedBox(width: Insets.md),
              Expanded(
                child: _dropdown(
                  label: 'Style',
                  value: _style,
                  options: _styles,
                  onChanged: (v) => setState(() => _style = v),
                ),
              ),
            ],
          ),
          const SizedBox(height: Insets.lg),
          SwButton(
            label: _loading ? 'Building...' : 'Build my outfit',
            onTap: _loading ? () {} : () => _build(),
          ),
        ],
      ),
    );
  }

  Widget _dropdown({
    required String label,
    required String value,
    required List<String> options,
    required ValueChanged<String> onChanged,
  }) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: label,
        border: const OutlineInputBorder(),
        isDense: true,
      ),
      items: [
        for (final o in options)
          DropdownMenuItem(value: o, child: Text(o, style: AppText.body)),
      ],
      onChanged: (v) {
        if (v != null) onChanged(v);
      },
    );
  }

  /// The mannequin with the picked pieces layered per outfit slot.
  Widget _avatarPanel() {
    Widget layer(String slot, double top, double left, double width) {
      final item = _itemForSlot(slot);
      if (item == null) return const SizedBox.shrink();
      return Positioned(
        top: top,
        left: left,
        width: width,
        child: SwProductImage(
          image: '${item['imageUrl'] ?? ''}',
          height: width,
          radius: Radii.sm,
        ),
      );
    }

    const panelWidth = 320.0;
    return Center(
      child: SwCard(
        padding: EdgeInsets.zero,
        clip: true,
        child: SizedBox(
          width: panelWidth,
          height: panelWidth * 1.25,
          child: Stack(
            children: [
              Positioned.fill(
                child: ColoredBox(
                  color: AppColors.background,
                  child: Image.asset(
                    Img.avatarMannequin,
                    fit: BoxFit.contain,
                    alignment: Alignment.topCenter,
                  ),
                ),
              ),
              // Layers are positioned relative to the mannequin art: top on
              // the torso, bottom on the legs, shoes at the feet, outerwear
              // and accessory to the sides.
              layer('top', 120, 120, 80),
              layer('bottom', 205, 120, 80),
              layer('shoes', 292, 126, 70),
              layer('outerwear', 120, 222, 72),
              layer('accessory', 215, 24, 64),
              Positioned(
                top: Insets.md,
                right: Insets.md,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: Insets.md,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: Radii.pillRadius,
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Text('Real store pieces', style: AppText.label),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _summary() {
    final total = (_result?['total'] as num?)?.toDouble() ?? 0;
    final budget = (_result?['budget'] as num?)?.toDouble() ?? 1;
    final match = (_result?['match'] as num?)?.toInt();
    final within = _result?['withinBudget'] == true;
    return SwCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Total ${total.toStringAsFixed(0)} EGP of ${budget.toStringAsFixed(0)} EGP',
                  style: AppText.bodyStrong,
                ),
              ),
              if (match != null)
                Text('$match% match', style: AppText.bodyStrong),
            ],
          ),
          const SizedBox(height: Insets.sm),
          ClipRRect(
            borderRadius: Radii.pillRadius,
            child: LinearProgressIndicator(
              value: (total / budget).clamp(0.0, 1.0),
              minHeight: 8,
            ),
          ),
          if (!within) ...[
            const SizedBox(height: Insets.sm),
            Text(
              'Core pieces do not fit this budget - try a higher amount.',
              style: AppText.caption,
            ),
          ],
        ],
      ),
    );
  }

  Widget _itemCard(Map<String, dynamic> item) {
    final hasLink = '${item['productUrl'] ?? ''}'.isNotEmpty;
    return SwCard(
      child: Row(
        children: [
          SwProductImage(
            image: '${item['imageUrl'] ?? ''}',
            width: 64,
            height: 64,
            radius: Radii.sm,
          ),
          const SizedBox(width: Insets.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${item['name'] ?? ''}',
                  style: AppText.bodyStrong,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  '${item['store'] ?? ''} - ${item['slot'] ?? ''}',
                  style: AppText.caption,
                ),
                Text(
                  '${(item['price'] as num?)?.toStringAsFixed(0) ?? ''} ${item['currency'] ?? 'EGP'}',
                  style: AppText.body,
                ),
              ],
            ),
          ),
          Column(
            children: [
              IconButton(
                tooltip: 'Swap this piece',
                onPressed: _loading ? null : () => _swap(item),
                icon: const SwIconView(SwIcon.refresh, size: 20),
              ),
              if (hasLink)
                IconButton(
                  tooltip: 'Open product page',
                  onPressed: () => _openProduct(item),
                  icon: const SwIconView(SwIcon.share, size: 20),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
