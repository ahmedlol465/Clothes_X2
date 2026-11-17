import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/models.dart' as app_models;
import 'fashion_critic_screen.dart';

// ==========================================
// 1. DATA MODELS
// ==========================================

/// A garment rendered on the styling canvas. Kept local because the canvas
/// only needs a small slice of the wardrobe shape (`id / name / category /
/// image`) while the shared [app_models.ClothingItem] carries the full profile.
class ClothingItem {
  ClothingItem({
    required this.id,
    required this.name,
    required this.category,
    required this.imageUrl,
  });

  final String id;
  final String name;
  final String category;
  final String imageUrl;
}

/// The look currently arranged on the canvas.
class OutfitSuggestion {
  OutfitSuggestion({
    required this.outfitId,
    required this.matchScore,
    required this.stylistNote,
    required this.items,
  });

  final String outfitId;
  final int matchScore;
  final String stylistNote;
  final List<ClothingItem> items;
}

// ==========================================
// 2. THE SCREEN
// ==========================================

class StylistDeskScreen extends StatefulWidget {
  const StylistDeskScreen({super.key});

  @override
  State<StylistDeskScreen> createState() => _StylistDeskScreenState();
}

class _StylistDeskScreenState extends State<StylistDeskScreen>
    with SingleTickerProviderStateMixin {
  static const double _canvasItemWidth = 110;
  static const double _canvasItemHeight = 162;

  static const List<String> _suggestions = [
    'Recommend an outfit for today',
    'Which colors work together?',
    'What should I wear to a party?',
    'Build a look from my saved items',
  ];

  List<String> _quickChips = [
    'Make it more formal',
    'Swap the shoes',
    'Make it warmer',
  ];
  bool _savingOutfit = false;

  final TextEditingController _chatController = TextEditingController();
  final FocusNode _chatFocus = FocusNode();
  final ScrollController _scroll = ScrollController();
  final ValueNotifier<String> _streaming = ValueNotifier<String>('');
  final ValueNotifier<int> _canvasRevision = ValueNotifier<int>(0);

  final Map<String, Offset> _itemPositions = {};
  Size _canvasSize = Size.zero;
  String? _activeItemKey;
  String? _draggingItemKey;
  Offset? _dragStartItemOffset;
  Offset? _dragStartGlobal;

  OutfitSuggestion? _currentOutfit;
  bool _isLoading = true;
  String? _errorMessage;

  final List<app_models.ChatMessage> _messages = [];
  bool _thinking = false;
  bool _atBottom = true;
  String? _lastUserText;

  late final AnimationController _welcomeController = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 650),
  );
  late final CurvedAnimation _welcomeAnim = CurvedAnimation(
    parent: _welcomeController,
    curve: Curves.easeOut,
  );

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
    _welcomeController.forward();
    // Refresh the shared wardrobe so the canvas picker and the header's
    // online indicator reflect the real backend state.
    AppState.instance.loadWardrobe();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadInitialOutfit());
  }

  @override
  void dispose() {
    _chatController.dispose();
    _chatFocus.dispose();
    _scroll.removeListener(_onScroll);
    _scroll.dispose();
    _streaming.dispose();
    _canvasRevision.dispose();
    _welcomeAnim.dispose();
    _welcomeController.dispose();
    super.dispose();
  }

  // ------------------------------------------------------------- canvas state

  Future<void> _loadInitialOutfit() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    try {
      final outfits = await AppState.instance.api.generateOutfit(
        occasion: 'casual',
        count: 1,
      );
      if (!mounted) return;
      final raw = outfits.isNotEmpty && outfits.first is Map
          ? Map<String, dynamic>.from(outfits.first as Map)
          : null;
      setState(() => _isLoading = false);
      if (raw == null) {
        setState(() => _errorMessage = 'No outfit suggestions yet.');
      } else {
        _applyOutfit(raw);
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _errorMessage = 'Could not reach the stylist.';
      });
    }
  }

  /// Renders a raw backend outfit onto the canvas and resets the arrangement.
  void _applyOutfit(Map<String, dynamic> raw) {
    var items = <ClothingItem>[
      for (final i in (raw['items'] as List? ?? const []))
        if (i is Map)
          ClothingItem(
            id: '${i['id'] ?? ''}',
            name: '${i['name'] ?? 'Item'}',
            category: '${i['category'] ?? 'Top'}',
            imageUrl: '${i['image'] ?? i['imageUrl'] ?? ''}',
          ),
    ];
    if (items.isEmpty) {
      final ids =
          (raw['itemIds'] as List?)
              ?.map((id) => '$id')
              .where((id) => id.isNotEmpty)
              .toList() ??
          const <String>[];
      items = [
        for (final id in ids)
          for (final item in AppState.instance.wardrobe)
            if (item.id == id)
              ClothingItem(
                id: item.id,
                name: item.name,
                category: item.category,
                imageUrl: item.image,
              ),
      ];
    }
    if (items.isEmpty) return;
    _resetItemPositions();
    setState(() {
      _currentOutfit = OutfitSuggestion(
        outfitId: '${raw['id'] ?? ''}',
        matchScore:
            (raw['match'] as num?)?.toInt() ??
            (raw['matchScore'] as num?)?.toInt() ??
            0,
        stylistNote: '${raw['explanation'] ?? raw['stylistNote'] ?? ''}',
        items: items,
      );
      _errorMessage = null;
    });
    _canvasRevision.value++;
  }

  String _itemKey(ClothingItem item, int index) =>
      item.id.isNotEmpty ? item.id : '${item.category}#$index';

  Offset _defaultItemOffset(String category, Size canvas) {
    final alignment = _getAlignmentForCategory(category);
    final availableWidth = canvas.width - _canvasItemWidth;
    final availableHeight = canvas.height - _canvasItemHeight;
    if (availableWidth <= 0 || availableHeight <= 0) return Offset.zero;
    return Offset(
      (alignment.x + 1) / 2 * availableWidth,
      (alignment.y + 1) / 2 * availableHeight,
    );
  }

  Offset _clampItemOffset(Offset offset, Size canvas) {
    final maxX = (canvas.width - _canvasItemWidth).clamp(0.0, double.infinity);
    final maxY = (canvas.height - _canvasItemHeight).clamp(
      0.0,
      double.infinity,
    );
    return Offset(
      offset.dx.clamp(0.0, maxX).toDouble(),
      offset.dy.clamp(0.0, maxY).toDouble(),
    );
  }

  Offset _itemOffset(ClothingItem item, int index, Size canvas) {
    final stored = _itemPositions[_itemKey(item, index)];
    return _clampItemOffset(
      stored ?? _defaultItemOffset(item.category, canvas),
      canvas,
    );
  }

  void _resetItemPositions() {
    _itemPositions.clear();
    _activeItemKey = null;
    _draggingItemKey = null;
    _dragStartItemOffset = null;
    _dragStartGlobal = null;
    _canvasRevision.value++;
  }

  void _startItemDrag(
    ClothingItem item,
    int index,
    LongPressStartDetails details,
  ) {
    if (_canvasSize.width <= 0 || _canvasSize.height <= 0) return;
    final key = _itemKey(item, index);
    _itemPositions[key] = _itemOffset(item, index, _canvasSize);
    _activeItemKey = key;
    _draggingItemKey = key;
    _dragStartItemOffset = _itemPositions[key];
    _dragStartGlobal = details.globalPosition;
    _canvasRevision.value++;
  }

  void _moveItem(LongPressMoveUpdateDetails details) {
    final key = _draggingItemKey;
    final startOffset = _dragStartItemOffset;
    final startGlobal = _dragStartGlobal;
    if (key == null || startOffset == null || startGlobal == null) return;
    _itemPositions[key] = _clampItemOffset(
      startOffset + (details.globalPosition - startGlobal),
      _canvasSize,
    );
    _canvasRevision.value++;
  }

  void _endItemDrag() {
    if (_draggingItemKey == null) return;
    _draggingItemKey = null;
    _dragStartItemOffset = null;
    _dragStartGlobal = null;
    _canvasRevision.value++;
  }

  Future<void> _handleItemTap(ClothingItem item, int index) async {
    if (_draggingItemKey != null) return;
    _activeItemKey = _itemKey(item, index);
    _canvasRevision.value++;
    final replacement = await _showReplacementSheet(item);
    if (replacement == null || !mounted) return;
    _replaceItem(index, replacement);
  }

  Future<app_models.ClothingItem?> _showReplacementSheet(ClothingItem item) {
    return showModalBottomSheet<app_models.ClothingItem>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      barrierColor: Colors.black.withValues(alpha: 0.32),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => _ReplacementSheet(item: item),
    );
  }

  void _replaceItem(int index, app_models.ClothingItem replacement) {
    final current = _currentOutfit;
    if (current == null || index < 0 || index >= current.items.length) return;
    final oldItem = current.items[index];
    if (oldItem.category.trim().toLowerCase() !=
        replacement.category.trim().toLowerCase()) {
      return;
    }

    final newItem = ClothingItem(
      id: replacement.id,
      name: replacement.name,
      category: replacement.category,
      imageUrl: replacement.image,
    );
    final oldKey = _itemKey(oldItem, index);
    final newKey = _itemKey(newItem, index);
    final previousOffset = _itemPositions[oldKey];
    if (previousOffset != null) _itemPositions[newKey] = previousOffset;
    if (oldKey != newKey) _itemPositions.remove(oldKey);
    _activeItemKey = newKey;

    final items = [...current.items];
    items[index] = newItem;
    setState(() {
      _currentOutfit = OutfitSuggestion(
        outfitId: current.outfitId,
        matchScore: current.matchScore,
        stylistNote: current.stylistNote,
        items: items,
      );
    });
    _canvasRevision.value++;
  }

  /// Positions a garment on the canvas based on its category, so a look reads
  /// top-to-bottom like a real flat lay.
  Alignment _getAlignmentForCategory(String category) {
    switch (category.toLowerCase()) {
      case 'tops':
      case 'top':
        return const Alignment(-0.6, -0.7);
      case 'bottoms':
      case 'bottom':
        return const Alignment(0.6, 0.1);
      case 'shoes':
        return const Alignment(0.0, 0.8);
      case 'dress':
        return const Alignment(0.0, 0.0);
      case 'outerwear':
        return const Alignment(-0.8, 0.0);
      case 'accessories':
      case 'accessory':
        return const Alignment(0.8, -0.6);
      default:
        return const Alignment(0.0, 0.0);
    }
  }

  // -------------------------------------------------------------- chat state

  void _onScroll() {
    if (!_scroll.hasClients) return;
    final atBottom =
        _scroll.position.pixels >= _scroll.position.maxScrollExtent - 24;
    if (atBottom != _atBottom) setState(() => _atBottom = atBottom);
  }

  void _scrollToEnd({bool force = false}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scroll.hasClients) return;
      final target = _scroll.position.maxScrollExtent;
      if (force || _atBottom) {
        _scroll.animateTo(
          target,
          duration: const Duration(milliseconds: 260),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _send([String? preset]) async {
    final text = (preset ?? _chatController.text).trim();
    if (text.isEmpty || _thinking) return;
    _chatController.clear();
    setState(() {
      _messages.add(app_models.ChatMessage(fromUser: true, text: text));
      _thinking = true;
    });
    _streaming.value = '';
    _scrollToEnd(force: true);
    await _runTurn(text);
  }

  Future<void> _runTurn(String text) async {
    final reply = await AppState.instance.streamStylist(
      text,
      onDelta: (partial) {
        if (!mounted) return;
        _streaming.value = partial;
        _scrollToEnd();
      },
    );
    if (!mounted) return;
    setState(() {
      _messages.add(
        app_models.ChatMessage(
          fromUser: false,
          text: reply.text,
          outfit: reply.outfit,
          source: reply.source,
          followUp: reply.followUp,
        ),
      );
      if (reply.suggestions.isNotEmpty) _quickChips = reply.suggestions;
      _thinking = false;
      _lastUserText = text;
    });
    _streaming.value = '';
    final raw = reply.outfitRaw;
    if (raw != null) _applyOutfit(raw);
    _scrollToEnd(force: true);
  }

  Future<void> _retry() async {
    final text = _lastUserText;
    if (_thinking || text == null) return;
    setState(() {
      if (_messages.isNotEmpty && !_messages.last.fromUser) {
        _messages.removeLast();
      }
      _thinking = true;
    });
    _streaming.value = '';
    _scrollToEnd(force: true);
    await _runTurn(text);
  }

  Future<void> _saveCurrentOutfit() async {
    final current = _currentOutfit;
    final ids =
        current?.items
            .map((item) => item.id)
            .where((id) => id.isNotEmpty)
            .toList() ??
        const <String>[];
    if (current == null || ids.isEmpty) {
      _notify('This look has no items to save.');
      return;
    }
    final candidate = app_models.Outfit(
      id: '',
      name: 'Stylist canvas look',
      image: '',
      occasion: 'Casual',
      match: current.matchScore,
      pieces: const <String>[],
      itemIds: ids,
    );
    setState(() => _savingOutfit = true);
    final result = await AppState.instance.createOutfit(
      name: candidate.name,
      itemIds: ids,
      occasion: candidate.occasion,
      compatibilityScore: current.matchScore,
      explanation: current.stylistNote,
      sourceOutfitId: current.outfitId.isEmpty ? null : current.outfitId,
    );
    if (!mounted) return;
    setState(() => _savingOutfit = false);
    switch (result) {
      case SaveOutfitResult.saved:
        _notify('Outfit saved.');
      case SaveOutfitResult.duplicate:
        _notify('Outfit already saved.');
      case SaveOutfitResult.failed:
        _notify(
          AppState.instance.lastError ?? 'Backend offline — try again shortly.',
        );
    }
  }

  void _notify(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  // ------------------------------------------------------------------- build

  @override
  Widget build(BuildContext context) {
    final palette = _Palette.of(context);
    final currentOutfit = _currentOutfit;
    final saveIds =
        currentOutfit?.items
            .map((item) => item.id)
            .where((id) => id.isNotEmpty)
            .toList() ??
        const <String>[];
    final saveCandidate = currentOutfit == null
        ? null
        : app_models.Outfit(
            id: '',
            name: 'Stylist canvas look',
            image: '',
            occasion: 'Casual',
            match: currentOutfit.matchScore,
            pieces: const <String>[],
            itemIds: saveIds,
          );
    return Scaffold(
      backgroundColor: palette.background,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _DeskHeader(
              palette: palette,
              onRefresh: _isLoading ? null : _loadInitialOutfit,
              saveCandidate: saveCandidate,
              onSaveOutfit: saveCandidate == null || _savingOutfit
                  ? null
                  : _saveCurrentOutfit,
              onOpenCritic: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const FashionCriticScreen()),
              ),
            ),
            Expanded(flex: 5, child: _buildCanvas(palette)),
            Expanded(flex: 5, child: _buildChat(palette)),
          ],
        ),
      ),
    );
  }

  Widget _buildCanvas(_Palette palette) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 4, 16, 12),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: palette.surface,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [BoxShadow(color: palette.shadow, blurRadius: 18)],
      ),
      child: _buildCanvasContent(palette),
    );
  }

  Widget _buildCanvasContent(_Palette palette) {
    if (_isLoading) return _CanvasLoading(palette: palette);
    final outfit = _currentOutfit;
    if (outfit == null) {
      return _CanvasError(
        palette: palette,
        message: _errorMessage ?? 'No outfit to show yet.',
        onRetry: _loadInitialOutfit,
      );
    }

    return ValueListenableBuilder<int>(
      valueListenable: _canvasRevision,
      builder: (context, _, _) {
        return LayoutBuilder(
          builder: (context, constraints) {
            final canvasSize = constraints.biggest;
            _canvasSize = canvasSize;
            final items = outfit.items;
            final entries = <({ClothingItem item, int index, String key})>[
              for (var i = 0; i < items.length; i++)
                (item: items[i], index: i, key: _itemKey(items[i], i)),
            ];
            final activeIndex = entries.indexWhere(
              (entry) => entry.key == _activeItemKey,
            );
            if (activeIndex >= 0) {
              entries.add(entries.removeAt(activeIndex));
            }

            return Stack(
              clipBehavior: Clip.hardEdge,
              children: [
                Positioned(
                  top: 16,
                  right: 16,
                  child: IgnorePointer(
                    child: _MatchBadge(
                      palette: palette,
                      score: outfit.matchScore,
                    ),
                  ),
                ),
                for (final entry in entries)
                  Positioned(
                    left: _itemOffset(entry.item, entry.index, canvasSize).dx,
                    top: _itemOffset(entry.item, entry.index, canvasSize).dy,
                    child: _CanvasClothingItem(
                      key: ValueKey(entry.key),
                      item: entry.item,
                      palette: palette,
                      onTap: () => _handleItemTap(entry.item, entry.index),
                      onLongPressStart: (details) =>
                          _startItemDrag(entry.item, entry.index, details),
                      onLongPressMoveUpdate: _moveItem,
                      onLongPressEnd: _endItemDrag,
                      onLongPressCancel: _endItemDrag,
                    ),
                  ),
              ],
            );
          },
        );
      },
    );
  }

  Widget _buildChat(_Palette palette) {
    return Container(
      decoration: BoxDecoration(
        color: palette.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
        boxShadow: [BoxShadow(color: palette.shadow, blurRadius: 16)],
      ),
      child: Column(
        children: [
          Expanded(child: _buildMessages(palette)),
          if (_messages.isNotEmpty && !_thinking) _buildQuickChips(palette),
          _Composer(
            controller: _chatController,
            focusNode: _chatFocus,
            palette: palette,
            busy: _thinking,
            onSend: () => _send(),
          ),
        ],
      ),
    );
  }

  Widget _buildMessages(_Palette palette) {
    if (_messages.isEmpty && !_thinking) {
      return _WelcomeView(
        palette: palette,
        animation: _welcomeAnim,
        suggestions: _suggestions,
        onSuggestion: _send,
      );
    }

    return Stack(
      children: [
        ListView.builder(
          controller: _scroll,
          padding: const EdgeInsets.fromLTRB(
            Insets.lg,
            Insets.lg,
            Insets.lg,
            Insets.sm,
          ),
          physics: const BouncingScrollPhysics(),
          itemCount: _messages.length + (_thinking ? 1 : 0),
          itemBuilder: (context, i) {
            if (i >= _messages.length) {
              return Padding(
                padding: const EdgeInsets.only(bottom: Insets.md),
                child: _StreamingBubble(palette: palette, text: _streaming),
              );
            }
            final message = _messages[i];
            return Padding(
              padding: const EdgeInsets.only(bottom: Insets.md),
              child: _MessageBubble(
                key: ValueKey('msg-$i-${message.text.hashCode}'),
                message: message,
                palette: palette,
                onRetry: message.source == 'offline' ? _retry : null,
              ),
            );
          },
        ),
        _ScrollToBottomButton(
          palette: palette,
          visible: !_atBottom,
          onTap: () {
            if (!_scroll.hasClients) return;
            _scroll.animateTo(
              _scroll.position.maxScrollExtent,
              duration: const Duration(milliseconds: 280),
              curve: Curves.easeOut,
            );
          },
        ),
      ],
    );
  }

  Widget _buildQuickChips(_Palette palette) {
    return SizedBox(
      height: 42,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        physics: const BouncingScrollPhysics(),
        padding: const EdgeInsets.symmetric(horizontal: Insets.lg),
        itemCount: _quickChips.length,
        separatorBuilder: (_, _) => const SizedBox(width: Insets.sm),
        itemBuilder: (context, i) => _QuickChip(
          label: _quickChips[i],
          palette: palette,
          onTap: _thinking ? null : () => _send(_quickChips[i]),
        ),
      ),
    );
  }
}

// ==========================================
// 3. THEME PALETTE
// ==========================================

/// Local colour palette for the desk. The app ships a light theme today, so
/// [_light] mirrors [AppColors] exactly; [_dark] is ready if a dark theme is
/// ever enabled and keeps the screen legible without touching global tokens.
class _Palette {
  const _Palette({
    required this.background,
    required this.surface,
    required this.surfaceAlt,
    required this.border,
    required this.primary,
    required this.primarySoft,
    required this.textPrimary,
    required this.textSecondary,
    required this.textTertiary,
    required this.bubbleUser,
    required this.bubbleAssistant,
    required this.shadow,
  });

  final Color background;
  final Color surface;
  final Color surfaceAlt;
  final Color border;
  final Color primary;
  final Color primarySoft;
  final Color textPrimary;
  final Color textSecondary;
  final Color textTertiary;
  final Color bubbleUser;
  final Color bubbleAssistant;
  final Color shadow;

  static _Palette of(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? _dark : _light;

  static const _light = _Palette(
    background: AppColors.background,
    surface: AppColors.surface,
    surfaceAlt: AppColors.tint,
    border: AppColors.border,
    primary: AppColors.primary,
    primarySoft: AppColors.iconTint,
    textPrimary: AppColors.textPrimary,
    textSecondary: AppColors.textSecondary,
    textTertiary: AppColors.textTertiary,
    bubbleUser: AppColors.primary,
    bubbleAssistant: AppColors.surface,
    shadow: Color(0x14000000),
  );

  static const _dark = _Palette(
    background: Color(0xFF15131A),
    surface: Color(0xFF1F1C26),
    surfaceAlt: Color(0xFF2A2633),
    border: Color(0xFF34303D),
    primary: Color(0xFF9D82D2),
    primarySoft: Color(0xFF2A2633),
    textPrimary: Color(0xFFF3F1EE),
    textSecondary: Color(0xFFB9B3C0),
    textTertiary: Color(0xFF807A8C),
    bubbleUser: Color(0xFF5E4B8B),
    bubbleAssistant: Color(0xFF1F1C26),
    shadow: Color(0x33000000),
  );
}

// ==========================================
// 4. WIDGETS
// ==========================================

class _DeskHeader extends StatelessWidget {
  const _DeskHeader({
    required this.palette,
    this.onRefresh,
    this.saveCandidate,
    this.onSaveOutfit,
    this.onOpenCritic,
  });

  final _Palette palette;
  final VoidCallback? onRefresh;
  final app_models.Outfit? saveCandidate;
  final VoidCallback? onSaveOutfit;
  final VoidCallback? onOpenCritic;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Insets.lg,
        Insets.md,
        Insets.lg,
        Insets.sm,
      ),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [AppColors.primary, AppColors.primaryMid],
              ),
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: AppColors.primary.withValues(alpha: 0.25),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: const SwIconView(
              SwIcon.sparkle,
              size: 20,
              color: Colors.white,
            ),
          ),
          const SizedBox(width: Insets.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'AI Stylist',
                  style: AppText.h4.copyWith(color: palette.textPrimary),
                ),
                const SizedBox(height: 2),
                _OnlineStatus(palette: palette),
              ],
            ),
          ),
          if (onSaveOutfit != null && saveCandidate != null)
            _SaveOutfitButton(
              palette: palette,
              candidate: saveCandidate!,
              onTap: onSaveOutfit!,
            ),
          if (onOpenCritic != null)
            _CriticToggleButton(palette: palette, onTap: onOpenCritic!),
          _RefreshButton(palette: palette, onTap: onRefresh),
        ],
      ),
    );
  }
}

class _RefreshButton extends StatelessWidget {
  const _RefreshButton({required this.palette, this.onTap});

  final _Palette palette;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: Sizes.iconButton,
        height: Sizes.iconButton,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: palette.surface,
          shape: BoxShape.circle,
          border: Border.all(color: palette.border),
        ),
        child: SwIconView(
          SwIcon.refresh,
          size: 18,
          color: onTap == null ? palette.textTertiary : palette.textPrimary,
        ),
      ),
    );
  }
}

class _SaveOutfitButton extends StatelessWidget {
  const _SaveOutfitButton({
    required this.palette,
    required this.candidate,
    required this.onTap,
  });

  final _Palette palette;
  final app_models.Outfit candidate;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: AppState.instance,
      builder: (context, _) {
        final saved = AppState.instance.savedOutfits.any(
          (outfit) => AppState.sameOutfit(outfit, candidate),
        );
        return GestureDetector(
          onTap: onTap,
          behavior: HitTestBehavior.opaque,
          child: Container(
            width: Sizes.iconButton,
            height: Sizes.iconButton,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: saved ? AppColors.tint : palette.surface,
              shape: BoxShape.circle,
              border: Border.all(color: palette.border),
            ),
            child: SwIconView(
              saved ? SwIcon.starFill : SwIcon.star,
              size: 18,
              color: AppColors.primary,
            ),
          ),
        );
      },
    );
  }
}

class _CriticToggleButton extends StatelessWidget {
  const _CriticToggleButton({required this.palette, required this.onTap});

  final _Palette palette;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: Sizes.iconButton,
        height: Sizes.iconButton,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: AppColors.tint,
          shape: BoxShape.circle,
        ),
        child: SwIconView(SwIcon.star, size: 18, color: AppColors.primary),
      ),
    );
  }
}

class _OnlineStatus extends StatelessWidget {
  const _OnlineStatus({required this.palette});

  final _Palette palette;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: AppState.instance,
      builder: (context, _) {
        final online = AppState.instance.backendOnline;
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(
                color: online ? AppColors.success : palette.textTertiary,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 6),
            Text(
              online
                  ? 'Online · ready to style'
                  : 'Offline · using saved looks',
              style: AppText.caption.copyWith(color: palette.textSecondary),
            ),
          ],
        );
      },
    );
  }
}

class _MatchBadge extends StatelessWidget {
  const _MatchBadge({required this.palette, required this.score});

  final _Palette palette;
  final int score;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: palette.primarySoft,
        borderRadius: Radii.pillRadius,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SwIconView(SwIcon.sparkle, size: 13, color: palette.primary),
          const SizedBox(width: 6),
          Text(
            '$score% Match',
            style: AppText.labelStrong.copyWith(color: palette.primary),
          ),
        ],
      ),
    );
  }
}

class _CanvasLoading extends StatelessWidget {
  const _CanvasLoading({required this.palette});

  final _Palette palette;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircularProgressIndicator(color: palette.primary, strokeWidth: 2.5),
          const SizedBox(height: Insets.md),
          Text(
            'Styling your look...',
            style: AppText.caption.copyWith(color: palette.textSecondary),
          ),
        ],
      ),
    );
  }
}

class _CanvasError extends StatelessWidget {
  const _CanvasError({
    required this.palette,
    required this.message,
    required this.onRetry,
  });

  final _Palette palette;
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Insets.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SwIconBadge(
              icon: SwIcon.alert,
              size: 48,
              iconSize: 22,
              background: palette.primarySoft,
              color: palette.primary,
            ),
            const SizedBox(height: Insets.md),
            Text(
              message,
              textAlign: TextAlign.center,
              style: AppText.body.copyWith(color: palette.textSecondary),
            ),
            const SizedBox(height: Insets.md),
            SwButton(label: 'Retry', expand: false, onTap: onRetry),
          ],
        ),
      ),
    );
  }
}

class _CanvasClothingItem extends StatelessWidget {
  const _CanvasClothingItem({
    super.key,
    required this.item,
    required this.palette,
    required this.onTap,
    required this.onLongPressStart,
    required this.onLongPressMoveUpdate,
    required this.onLongPressEnd,
    required this.onLongPressCancel,
  });

  final ClothingItem item;
  final _Palette palette;
  final VoidCallback onTap;
  final void Function(LongPressStartDetails details) onLongPressStart;
  final void Function(LongPressMoveUpdateDetails details) onLongPressMoveUpdate;
  final VoidCallback onLongPressEnd;
  final VoidCallback onLongPressCancel;

  @override
  Widget build(BuildContext context) {
    final bool isNetwork = item.imageUrl.startsWith('http');
    final bool hasImage = item.imageUrl.isNotEmpty;

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      onLongPressStart: onLongPressStart,
      onLongPressMoveUpdate: onLongPressMoveUpdate,
      onLongPressEnd: (_) => onLongPressEnd(),
      onLongPressCancel: onLongPressCancel,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 110,
            height: 130,
            decoration: BoxDecoration(
              color: palette.surfaceAlt,
              borderRadius: BorderRadius.circular(16),
              boxShadow: [
                BoxShadow(
                  color: palette.shadow,
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: !hasImage
                  ? Center(
                      child: SwIconView(
                        SwIcon.shirt,
                        size: 44,
                        color: palette.textTertiary,
                      ),
                    )
                  : isNetwork
                  ? Image.network(
                      item.imageUrl,
                      fit: BoxFit.cover,
                      loadingBuilder: (context, child, progress) {
                        if (progress == null) return child;
                        return Center(
                          child: SizedBox(
                            width: 24,
                            height: 24,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: palette.primary,
                            ),
                          ),
                        );
                      },
                      errorBuilder: (context, error, stackTrace) => Center(
                        child: Icon(
                          Icons.broken_image,
                          color: palette.textTertiary,
                          size: 40,
                        ),
                      ),
                    )
                  : Image.asset(
                      item.imageUrl,
                      fit: BoxFit.cover,
                      errorBuilder: (context, error, stackTrace) => Center(
                        child: Icon(
                          Icons.broken_image,
                          color: palette.textTertiary,
                          size: 40,
                        ),
                      ),
                    ),
            ),
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: palette.surface,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: palette.border),
            ),
            child: Text(
              item.name,
              style: AppText.labelStrong.copyWith(
                color: palette.textPrimary,
                fontSize: 12,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

/// Category-filtered wardrobe picker for one canvas garment.
///
/// Alternatives come from the same backend wardrobe API used by the Wardrobe
/// and Create Outfit screens. The selected garment is excluded so every row is
/// an actual replacement.
class _ReplacementSheet extends StatefulWidget {
  const _ReplacementSheet({required this.item});

  final ClothingItem item;

  @override
  State<_ReplacementSheet> createState() => _ReplacementSheetState();
}

class _ReplacementSheetState extends State<_ReplacementSheet> {
  late Future<List<app_models.ClothingItem>> _alternatives;

  @override
  void initState() {
    super.initState();
    _alternatives = _loadAlternatives();
  }

  Future<List<app_models.ClothingItem>> _loadAlternatives() async {
    final category = widget.item.category.trim();
    if (category.isEmpty) return const [];
    try {
      final res = await AppState.instance.api.wardrobeItems(category: category);
      final items = [
        for (final raw in (res['items'] as List? ?? const []))
          app_models.ClothingItem.fromJson(
            Map<String, dynamic>.from(raw as Map),
          ),
      ];
      return _sameCategory(items, category);
    } catch (_) {
      // Match the rest of the app: keep the sheet usable when the backend is
      // offline by using the currently loaded wardrobe list.
      return _sameCategory(AppState.instance.wardrobe, category);
    }
  }

  List<app_models.ClothingItem> _sameCategory(
    List<app_models.ClothingItem> items,
    String category,
  ) {
    final wanted = category.toLowerCase();
    return [
      for (final item in items)
        if (item.id != widget.item.id &&
            item.category.trim().toLowerCase() == wanted)
          item,
    ];
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.5,
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
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Replace ${widget.item.name}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.h4,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${widget.item.category} only',
                          style: AppText.caption,
                        ),
                      ],
                    ),
                  ),
                  SwIconButton(
                    icon: SwIconButtonKind.close,
                    onTap: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
              const SizedBox(height: Insets.md),
              Expanded(
                child: FutureBuilder<List<app_models.ClothingItem>>(
                  future: _alternatives,
                  builder: (context, snapshot) {
                    if (snapshot.connectionState != ConnectionState.done) {
                      return const Center(
                        child: CircularProgressIndicator(
                          color: AppColors.primary,
                        ),
                      );
                    }
                    final items = snapshot.data ?? const [];
                    if (items.isEmpty) {
                      return Center(
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
                              'No other ${widget.item.category.toLowerCase()} yet',
                              textAlign: TextAlign.center,
                              style: AppText.cardTitle,
                            ),
                            const SizedBox(height: Insets.xs),
                            Text(
                              'Add more in the Wardrobe tab.',
                              textAlign: TextAlign.center,
                              style: AppText.caption,
                            ),
                          ],
                        ),
                      );
                    }
                    return ListView.separated(
                      physics: const BouncingScrollPhysics(),
                      padding: const EdgeInsets.only(bottom: Insets.lg),
                      itemCount: items.length,
                      separatorBuilder: (_, _) =>
                          const SizedBox(height: Insets.sm),
                      itemBuilder: (context, i) {
                        final item = items[i];
                        return SwCard(
                          onTap: () => Navigator.of(context).pop(item),
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
                                  crossAxisAlignment: CrossAxisAlignment.start,
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
                              const SwIconView(
                                SwIcon.chevronRight,
                                size: 16,
                                color: AppColors.textTertiary,
                              ),
                            ],
                          ),
                        );
                      },
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

class _MessageBubble extends StatefulWidget {
  const _MessageBubble({
    super.key,
    required this.message,
    required this.palette,
    this.onRetry,
  });

  final app_models.ChatMessage message;
  final _Palette palette;
  final VoidCallback? onRetry;

  @override
  State<_MessageBubble> createState() => _MessageBubbleState();
}

class _MessageBubbleState extends State<_MessageBubble>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 260),
  );
  late final Animation<double> _fade = CurvedAnimation(
    parent: _controller,
    curve: Curves.easeOut,
  );
  late final Animation<Offset> _slide = Tween(
    begin: const Offset(0, 0.12),
    end: Offset.zero,
  ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic));
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    final reduce = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    if (reduce) {
      _controller.value = 1;
    } else {
      _controller.forward();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _fade,
      child: SlideTransition(
        position: _slide,
        child: widget.message.fromUser
            ? _userBubble(context)
            : _assistantBubble(),
      ),
    );
  }

  Widget _userBubble(BuildContext context) {
    return Align(
      alignment: Alignment.centerRight,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * 0.78,
        ),
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: Insets.lg,
            vertical: Insets.md,
          ),
          decoration: BoxDecoration(
            color: widget.palette.bubbleUser,
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(Radii.xl),
              topRight: Radius.circular(Radii.xl),
              bottomLeft: Radius.circular(Radii.xl),
              bottomRight: Radius.circular(Radii.xs),
            ),
          ),
          child: Text(
            widget.message.text,
            style: AppText.body.copyWith(color: Colors.white, fontSize: 14),
          ),
        ),
      ),
    );
  }

  Widget _assistantBubble() {
    final palette = widget.palette;
    final bodyStyle = AppText.body.copyWith(
      color: palette.textPrimary,
      fontSize: 14,
    );
    final codeStyle = AppText.body.copyWith(
      color: palette.primary,
      fontSize: 13,
      fontFamily: 'monospace',
      backgroundColor: palette.primarySoft,
    );

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _AssistantAvatar(palette: palette, size: 28),
        const SizedBox(width: Insets.sm),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: Insets.lg,
                  vertical: Insets.md,
                ),
                decoration: BoxDecoration(
                  color: palette.bubbleAssistant,
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(Radii.xs),
                    topRight: Radius.circular(Radii.xl),
                    bottomLeft: Radius.circular(Radii.xl),
                    bottomRight: Radius.circular(Radii.xl),
                  ),
                  border: Border.all(color: palette.border),
                ),
                child: _MarkdownText(
                  widget.message.text,
                  style: bodyStyle,
                  codeStyle: codeStyle,
                ),
              ),
              if (widget.message.source == 'rules')
                Padding(
                  padding: const EdgeInsets.only(left: 2, top: 4),
                  child: Text(
                    'Rule engine — no AI key configured',
                    style: AppText.caption.copyWith(
                      fontSize: 10,
                      color: palette.textTertiary,
                    ),
                  ),
                ),
              if (widget.message.outfit != null)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: _CanvasUpdatedChip(palette: palette),
                ),
              if (widget.onRetry != null)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: _RetryButton(palette: palette, onTap: widget.onRetry!),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _AssistantAvatar extends StatelessWidget {
  const _AssistantAvatar({required this.palette, this.size = 28});

  final _Palette palette;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: palette.primary, shape: BoxShape.circle),
      child: SwIconView(SwIcon.sparkle, size: size * 0.5, color: Colors.white),
    );
  }
}

class _CanvasUpdatedChip extends StatelessWidget {
  const _CanvasUpdatedChip({required this.palette});

  final _Palette palette;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: palette.primarySoft,
        borderRadius: Radii.pillRadius,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SwIconView(SwIcon.sparkle, size: 13, color: palette.primary),
          const SizedBox(width: 6),
          Text(
            'Outfit updated on your canvas',
            style: AppText.caption.copyWith(color: palette.primary),
          ),
        ],
      ),
    );
  }
}

class _RetryButton extends StatelessWidget {
  const _RetryButton({required this.palette, required this.onTap});

  final _Palette palette;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: palette.surface,
          borderRadius: Radii.pillRadius,
          border: Border.all(color: palette.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SwIconView(SwIcon.refresh, size: 13, color: palette.primary),
            const SizedBox(width: 6),
            Text(
              'Retry',
              style: AppText.label.copyWith(color: palette.primary),
            ),
          ],
        ),
      ),
    );
  }
}

class _StreamingBubble extends StatelessWidget {
  const _StreamingBubble({required this.palette, required this.text});

  final _Palette palette;
  final ValueNotifier<String> text;

  @override
  Widget build(BuildContext context) {
    final bodyStyle = AppText.body.copyWith(
      color: palette.textPrimary,
      fontSize: 14,
    );
    final codeStyle = AppText.body.copyWith(
      color: palette.primary,
      fontSize: 13,
      fontFamily: 'monospace',
      backgroundColor: palette.primarySoft,
    );

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _AssistantAvatar(palette: palette, size: 28),
        const SizedBox(width: Insets.sm),
        Flexible(
          child: Container(
            padding: const EdgeInsets.symmetric(
              horizontal: Insets.lg,
              vertical: Insets.md,
            ),
            decoration: BoxDecoration(
              color: palette.bubbleAssistant,
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(Radii.xs),
                topRight: Radius.circular(Radii.xl),
                bottomLeft: Radius.circular(Radii.xl),
                bottomRight: Radius.circular(Radii.xl),
              ),
              border: Border.all(color: palette.border),
            ),
            child: ValueListenableBuilder<String>(
              valueListenable: text,
              builder: (context, value, _) {
                if (value.isEmpty) return _TypingDots(palette: palette);
                return _MarkdownText(
                  value,
                  style: bodyStyle,
                  codeStyle: codeStyle,
                );
              },
            ),
          ),
        ),
      ],
    );
  }
}

/// Three-dot indicator shown while the assistant is thinking.
class _TypingDots extends StatefulWidget {
  const _TypingDots({required this.palette});

  final _Palette palette;

  @override
  State<_TypingDots> createState() => _TypingDotsState();
}

class _TypingDotsState extends State<_TypingDots>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) => Row(
        mainAxisSize: MainAxisSize.min,
        children: List.generate(3, (i) {
          final phase = (_controller.value * 3 - i).clamp(0.0, 1.0);
          final lift = (phase < 0.5 ? phase : 1 - phase) * 4;
          return Padding(
            padding: EdgeInsets.only(right: i == 2 ? 0 : 5, bottom: lift),
            child: Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                color: widget.palette.textTertiary.withValues(
                  alpha: 0.4 + lift / 8,
                ),
                shape: BoxShape.circle,
              ),
            ),
          );
        }),
      ),
    );
  }
}

class _WelcomeView extends StatelessWidget {
  const _WelcomeView({
    required this.palette,
    required this.animation,
    required this.suggestions,
    required this.onSuggestion,
  });

  final _Palette palette;
  final Animation<double> animation;
  final List<String> suggestions;
  final void Function(String) onSuggestion;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
        Insets.xl,
        Insets.xl,
        Insets.xl,
        Insets.md,
      ),
      physics: const BouncingScrollPhysics(),
      child: FadeTransition(
        opacity: animation,
        child: SlideTransition(
          position: Tween(
            begin: const Offset(0, 0.05),
            end: Offset.zero,
          ).animate(animation),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 54,
                height: 54,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [AppColors.primary, AppColors.primaryMid],
                  ),
                  borderRadius: BorderRadius.circular(18),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.primary.withValues(alpha: 0.25),
                      blurRadius: 12,
                      offset: const Offset(0, 5),
                    ),
                  ],
                ),
                child: const SwIconView(
                  SwIcon.sparkle,
                  size: 26,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: Insets.lg),
              Text(
                "Hi! I'm your AI stylist",
                style: AppText.h3.copyWith(color: palette.textPrimary),
              ),
              const SizedBox(height: Insets.xs),
              Text(
                'Ask me to build a look, explain a match, or remix what is on '
                'your canvas. I remember your wardrobe and taste as we chat.',
                style: AppText.body.copyWith(color: palette.textSecondary),
              ),
              const SizedBox(height: Insets.xl),
              for (final suggestion in suggestions)
                Padding(
                  padding: const EdgeInsets.only(bottom: Insets.sm),
                  child: _SuggestionTile(
                    label: suggestion,
                    palette: palette,
                    onTap: () => onSuggestion(suggestion),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SuggestionTile extends StatelessWidget {
  const _SuggestionTile({
    required this.label,
    required this.palette,
    required this.onTap,
  });

  final String label;
  final _Palette palette;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: palette.surfaceAlt,
      borderRadius: Radii.cardRadius,
      child: InkWell(
        onTap: onTap,
        borderRadius: Radii.cardRadius,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: Insets.lg,
            vertical: Insets.md,
          ),
          child: Row(
            children: [
              SwIconView(SwIcon.sparkle, size: 16, color: palette.primary),
              const SizedBox(width: Insets.md),
              Expanded(
                child: Text(
                  label,
                  style: AppText.bodyStrong.copyWith(
                    color: palette.textPrimary,
                    fontSize: 13,
                  ),
                ),
              ),
              SwIconView(
                SwIcon.chevronRight,
                size: 16,
                color: palette.textTertiary,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _QuickChip extends StatelessWidget {
  const _QuickChip({required this.label, required this.palette, this.onTap});

  final String label;
  final _Palette palette;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        alignment: Alignment.center,
        padding: const EdgeInsets.symmetric(horizontal: Insets.md, vertical: 8),
        decoration: BoxDecoration(
          color: palette.surfaceAlt,
          borderRadius: Radii.pillRadius,
          border: Border.all(color: palette.border),
        ),
        child: Text(
          label,
          style: AppText.label.copyWith(color: palette.textPrimary),
        ),
      ),
    );
  }
}

class _ScrollToBottomButton extends StatelessWidget {
  const _ScrollToBottomButton({
    required this.palette,
    required this.visible,
    required this.onTap,
  });

  final _Palette palette;
  final bool visible;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Positioned(
      right: Insets.lg,
      bottom: Insets.sm,
      child: IgnorePointer(
        ignoring: !visible,
        child: AnimatedOpacity(
          opacity: visible ? 1 : 0,
          duration: const Duration(milliseconds: 180),
          child: GestureDetector(
            onTap: onTap,
            child: Container(
              width: 40,
              height: 40,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: palette.surface,
                shape: BoxShape.circle,
                border: Border.all(color: palette.border),
                boxShadow: [BoxShadow(color: palette.shadow, blurRadius: 8)],
              ),
              child: SwIconView(
                SwIcon.chevronDown,
                size: 18,
                color: palette.textPrimary,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.focusNode,
    required this.palette,
    required this.onSend,
    required this.busy,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final _Palette palette;
  final VoidCallback onSend;
  final bool busy;

  /// Web and desktop keyboards have a real Enter key, so Enter sends; on mobile
  /// Enter inserts a newline and the send button submits instead.
  bool get _enterToSend =>
      kIsWeb ||
      defaultTargetPlatform == TargetPlatform.windows ||
      defaultTargetPlatform == TargetPlatform.macOS ||
      defaultTargetPlatform == TargetPlatform.linux;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(
        Insets.lg,
        Insets.sm,
        Insets.lg,
        Insets.md,
      ),
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border(top: BorderSide(color: palette.border)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: TextField(
              controller: controller,
              focusNode: focusNode,
              enabled: !busy,
              minLines: 1,
              maxLines: _enterToSend ? 1 : 4,
              textInputAction: _enterToSend
                  ? TextInputAction.send
                  : TextInputAction.newline,
              onSubmitted: _enterToSend ? (_) => onSend() : null,
              style: AppText.field.copyWith(color: palette.textPrimary),
              cursorColor: palette.primary,
              decoration: InputDecoration(
                hintText: 'Ask your stylist...',
                hintStyle: AppText.fieldHint.copyWith(
                  color: palette.textTertiary,
                ),
                filled: true,
                fillColor: palette.surfaceAlt,
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: Insets.lg,
                  vertical: 12,
                ),
                border: OutlineInputBorder(
                  borderRadius: Radii.pillRadius,
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          const SizedBox(width: Insets.sm),
          _SendButton(palette: palette, enabled: !busy, onTap: onSend),
        ],
      ),
    );
  }
}

class _SendButton extends StatefulWidget {
  const _SendButton({
    required this.palette,
    required this.enabled,
    required this.onTap,
  });

  final _Palette palette;
  final bool enabled;
  final VoidCallback onTap;

  @override
  State<_SendButton> createState() => _SendButtonState();
}

class _SendButtonState extends State<_SendButton> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final color = widget.enabled
        ? widget.palette.primary
        : widget.palette.primary.withValues(alpha: 0.4);
    return GestureDetector(
      onTapDown: widget.enabled ? (_) => setState(() => _pressed = true) : null,
      onTapUp: widget.enabled ? (_) => setState(() => _pressed = false) : null,
      onTapCancel: () => setState(() => _pressed = false),
      onTap: widget.enabled ? widget.onTap : null,
      child: AnimatedScale(
        scale: _pressed ? 0.9 : 1,
        duration: const Duration(milliseconds: 120),
        child: Container(
          width: 46,
          height: 46,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          child: const SwIconView(SwIcon.send, size: 19, color: Colors.white),
        ),
      ),
    );
  }
}

/// Minimal markdown renderer for assistant replies.
///
/// Supports ATX headings, unordered/ordered lists, fenced code blocks and
/// paragraphs, with inline `**bold**`, `__bold__`, `*italic*`, `_italic_` and
/// `` `code` ``. The app ships no markdown dependency, so this keeps the reply
/// readable without pulling one in.
class _MarkdownText extends StatelessWidget {
  const _MarkdownText(
    this.text, {
    required this.style,
    required this.codeStyle,
  });

  final String text;
  final TextStyle style;
  final TextStyle codeStyle;

  @override
  Widget build(BuildContext context) {
    final blocks = _blocks(text);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < blocks.length; i++) ...[
          if (i > 0) const SizedBox(height: 8),
          blocks[i],
        ],
      ],
    );
  }

  List<Widget> _blocks(String source) {
    final widgets = <Widget>[];
    final lines = source.replaceAll('\r\n', '\n').split('\n');
    var i = 0;
    while (i < lines.length) {
      final line = lines[i];
      final left = line.trimLeft();

      if (left.startsWith('```')) {
        final buffer = StringBuffer();
        i++;
        while (i < lines.length && !lines[i].trimLeft().startsWith('```')) {
          buffer.writeln(lines[i]);
          i++;
        }
        i++;
        widgets.add(_codeBlock(buffer.toString().trimRight()));
        continue;
      }

      if (line.trim().isEmpty) {
        i++;
        continue;
      }

      final heading = RegExp(r'^(#{1,6})\s+(.*)$').firstMatch(left);
      if (heading != null) {
        final level = heading.group(1)!.length;
        final size = switch (level) {
          1 => 18.0,
          2 => 16.0,
          3 => 15.0,
          _ => 14.0,
        };
        widgets.add(
          _rich(
            heading.group(2)!,
            style.copyWith(fontSize: size, fontWeight: FontWeight.w700),
          ),
        );
        i++;
        continue;
      }

      final bullet = RegExp(r'^[-*•]\s+(.*)$').firstMatch(left);
      if (bullet != null) {
        widgets.add(_bullet(bullet.group(1)!));
        i++;
        continue;
      }

      final ordered = RegExp(r'^(\d+)[.)]\s+(.*)$').firstMatch(left);
      if (ordered != null) {
        widgets.add(_ordered(ordered.group(1)!, ordered.group(2)!));
        i++;
        continue;
      }

      final paragraph = StringBuffer(line.trimRight());
      i++;
      while (i < lines.length) {
        final next = lines[i];
        final nextLeft = next.trimLeft();
        if (next.trim().isEmpty ||
            nextLeft.startsWith('```') ||
            RegExp(r'^#{1,6}\s+').hasMatch(nextLeft) ||
            RegExp(r'^[-*•]\s+').hasMatch(nextLeft) ||
            RegExp(r'^\d+[.)]\s+').hasMatch(nextLeft)) {
          break;
        }
        paragraph.write(' ${next.trimRight()}');
        i++;
      }
      widgets.add(_rich(paragraph.toString(), style));
    }
    return widgets;
  }

  Widget _rich(String content, TextStyle base) =>
      Text.rich(TextSpan(children: _inline(content, base)));

  Widget _bullet(String content) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Padding(
        padding: const EdgeInsets.only(top: 6, right: 8),
        child: Container(
          width: 5,
          height: 5,
          decoration: BoxDecoration(color: style.color, shape: BoxShape.circle),
        ),
      ),
      Expanded(child: _rich(content, style)),
    ],
  );

  Widget _ordered(String number, String content) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      SizedBox(width: 22, child: Text('$number.', style: style)),
      Expanded(child: _rich(content, style)),
    ],
  );

  Widget _codeBlock(String code) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(Insets.md),
    decoration: BoxDecoration(
      color: codeStyle.backgroundColor,
      borderRadius: Radii.smRadius,
    ),
    child: Text(
      code,
      style: codeStyle.copyWith(backgroundColor: null, height: 1.4),
    ),
  );

  List<TextSpan> _inline(String content, TextStyle base) {
    final spans = <TextSpan>[];
    final pattern = RegExp(
      r'(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_)',
    );
    var index = 0;
    for (final match in pattern.allMatches(content)) {
      if (match.start > index) {
        spans.add(
          TextSpan(text: content.substring(index, match.start), style: base),
        );
      }
      final token = match.group(0)!;
      if (token.startsWith('**') || token.startsWith('__')) {
        spans.add(
          TextSpan(
            text: token.substring(2, token.length - 2),
            style: base.copyWith(fontWeight: FontWeight.w700),
          ),
        );
      } else if (token.startsWith('`')) {
        spans.add(
          TextSpan(
            text: token.substring(1, token.length - 1),
            style: codeStyle,
          ),
        );
      } else {
        spans.add(
          TextSpan(
            text: token.substring(1, token.length - 1),
            style: base.copyWith(fontStyle: FontStyle.italic),
          ),
        );
      }
      index = match.end;
    }
    if (index < content.length) {
      spans.add(TextSpan(text: content.substring(index), style: base));
    }
    if (spans.isEmpty) spans.add(TextSpan(text: content, style: base));
    return spans;
  }
}
