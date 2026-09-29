import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/mock_data.dart';
import '../../data/models.dart';
import '../discover/discover_screen.dart';
import '../outfits/perfect_match_screen.dart';

/// Frame 12 - conversational styling assistant.
class StylistScreen extends StatefulWidget {
  const StylistScreen({super.key});

  @override
  State<StylistScreen> createState() => _StylistScreenState();
}

class _StylistScreenState extends State<StylistScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  late final List<ChatMessage> _messages = [...MockData.stylistIntro];
  bool _thinking = false;

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeOut,
      );
    });
  }

  void _send([String? preset]) async {
    final text = (preset ?? _input.text).trim();
    if (text.isEmpty || _thinking) return;

    setState(() {
      _messages.add(ChatMessage(fromUser: true, text: text));
      // Placeholder row the stream writes into; replaced with the finished
      // message (outfit card, follow-up) when `done` lands.
      _messages.add(ChatMessage(fromUser: false, text: ''));
      _thinking = true;
    });
    _input.clear();
    _scrollToEnd();

    // Wardrobe-aware streamed reply (§8.4 POST /ai/chat/stream). The server
    // answers with the rule engine when no LLM key is set, so the same call
    // works either way; the bundled replies remain the last-resort fallback.
    final reply = await AppState.instance.streamStylist(
      text,
      onDelta: (partial) {
        if (!mounted) return;
        setState(() => _messages[_messages.length - 1] =
            ChatMessage(fromUser: false, text: partial));
        _scrollToEnd();
      },
    );
    if (!mounted) return;
    setState(() {
      _messages[_messages.length - 1] = ChatMessage(
        fromUser: false,
        text: reply.text,
        outfit: reply.outfit,
        source: reply.source,
      );
      _thinking = false;
    });
    _scrollToEnd();
  }

  /// The flagship vision flow: photo of an outfit → matched against the
  /// wardrobe (`POST /ai/match-outfit`).
  Future<void> _matchPhoto() async {
    if (_thinking) return;
    final picker = ImagePicker();
    final XFile? file;
    try {
      file = await picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1600,
        imageQuality: 85,
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _messages.add(
            ChatMessage(
              fromUser: false,
              text: 'Could not open the gallery on this device.',
            ),
          ));
      return;
    }
    if (file == null || !mounted) return;

    final bytes = await file.readAsBytes().catchError((_) => Uint8List(0));
    if (!mounted) return;
    setState(() {
      _messages.add(ChatMessage(fromUser: true, text: 'Match this outfit'));
      _messages.add(ChatMessage(fromUser: false, text: ''));
      _thinking = true;
    });
    _scrollToEnd();

    final match = await AppState.instance.matchOutfitPhoto(
      bytes: bytes.isEmpty ? null : bytes,
      filename: file.name.isEmpty ? 'reference.jpg' : file.name,
      mimeType: file.mimeType ?? _mimeFor(file.name),
    );
    if (!mounted) return;
    setState(() {
      _thinking = false;
      _messages[_messages.length - 1] = match == null
          ? ChatMessage(
              fromUser: false,
              text: 'Style matching is unavailable right now. Check that the '
                  'backend is running and try again.',
            )
          : ChatMessage(
              fromUser: false,
              text: _matchSummary(match),
              match: match,
              source: match.source,
            );
    });
    _scrollToEnd();
  }

  static String _mimeFor(String name) {
    final n = name.toLowerCase();
    if (n.endsWith('.png')) return 'image/png';
    if (n.endsWith('.webp')) return 'image/webp';
    if (n.endsWith('.heic') || n.endsWith('.heif')) return 'image/heic';
    return 'image/jpeg';
  }

  static String _matchSummary(OutfitMatch match) {
    final filled = match.matches.where((m) => m.itemName.isNotEmpty).length;
    return '${match.title}: I can build $filled of ${match.matches.length} '
        'pieces from your wardrobe (${match.similarity}% similar).';
  }

  @override
  Widget build(BuildContext context) {
    return SwScreen(
      child: Column(
        children: [
          const _StylistHeader(),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              Insets.gutter,
              Insets.md,
              Insets.gutter,
              0,
            ),
            child: _DiscoverLink(
              onTap: () => Navigator.of(
                context,
              ).push(MaterialPageRoute(builder: (_) => const DiscoverScreen())),
            ),
          ),
          Expanded(
            child: ListView.builder(
              controller: _scroll,
              padding: const EdgeInsets.fromLTRB(
                Insets.lg,
                Insets.lg,
                Insets.lg,
                Insets.sm,
              ),
              physics: const BouncingScrollPhysics(),
              itemCount: _messages.length,
              itemBuilder: (context, i) {
                final message = _messages[i];
                return Padding(
                  padding: const EdgeInsets.only(bottom: Insets.md),
                  child: _Bubble(message: message),
                );
              },
            ),
          ),
          _Composer(
            controller: _input,
            onSend: _send,
            onMatchPhoto: _matchPhoto,
            busy: _thinking,
          ),
        ],
      ),
    );
  }
}

class _StylistHeader extends StatelessWidget {
  const _StylistHeader();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Insets.lg,
        Insets.md,
        Insets.lg,
        Insets.md,
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: const BoxDecoration(
              color: AppColors.primary,
              shape: BoxShape.circle,
            ),
            child: const SwIconView(
              SwIcon.sparkle,
              size: 19,
              color: Colors.white,
            ),
          ),
          const SizedBox(width: Insets.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('AI Stylist', style: AppText.h4),
                Text('Your personal fashion assistant', style: AppText.caption),
              ],
            ),
          ),
          SwIconButton(
            icon: SwIconButtonKind.close,
            onTap: () => ScaffoldMessenger.of(context)
              ..hideCurrentSnackBar()
              ..showSnackBar(
                const SnackBar(content: Text('Conversation cleared.')),
              ),
          ),
        ],
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    if (message.fromUser) {
      return Align(
        alignment: Alignment.centerRight,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 280),
          child: Container(
            margin: const EdgeInsets.only(left: 48),
            padding: const EdgeInsets.symmetric(
              horizontal: Insets.lg,
              vertical: Insets.md,
            ),
            decoration: const BoxDecoration(
              color: AppColors.primary,
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(Radii.xl),
                topRight: Radius.circular(Radii.xl),
                bottomLeft: Radius.circular(Radii.xl),
                bottomRight: Radius.circular(Radii.xs),
              ),
            ),
            child: Text(
              message.text,
              style: AppText.body.copyWith(color: Colors.white, fontSize: 13),
            ),
          ),
        ),
      );
    }

    return Align(
      alignment: Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 300),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 26,
                  height: 26,
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(
                    color: AppColors.primary,
                    shape: BoxShape.circle,
                  ),
                  child: const SwIconView(
                    SwIcon.sparkle,
                    size: 13,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(width: Insets.sm),
                Flexible(
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: Insets.lg,
                      vertical: Insets.md,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: const BorderRadius.only(
                        topLeft: Radius.circular(Radii.xs),
                        topRight: Radius.circular(Radii.xl),
                        bottomLeft: Radius.circular(Radii.xl),
                        bottomRight: Radius.circular(Radii.xl),
                      ),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Builder(
                      builder: (context) {
                        // An empty assistant bubble is the streaming
                        // placeholder: show the typing indicator in place of
                        // an empty box.
                        if (message.text.isEmpty) return const _TypingDots();
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              message.text,
                              style: AppText.body.copyWith(
                                color: AppColors.textPrimary,
                                fontSize: 13,
                              ),
                            ),
                            if (message.followUp != null) ...[
                              const SizedBox(height: 6),
                              Text(
                                message.followUp!,
                                style: AppText.caption.copyWith(
                                  color: AppColors.primary,
                                ),
                              ),
                            ],
                          ],
                        );
                      },
                    ),
                  ),
                ),
              ],
            ),
            if (!message.fromUser && message.source == 'rules')
              Padding(
                padding: const EdgeInsets.only(left: 34, top: 3),
                child: Text(
                  'Rule engine — no AI key configured',
                  style: AppText.caption.copyWith(fontSize: 10),
                ),
              ),
            if (message.match != null)
              Padding(
                padding: const EdgeInsets.only(left: 34, top: Insets.sm),
                child: _MatchResultCard(match: message.match!),
              ),
            if (message.outfit != null)
              Padding(
                padding: const EdgeInsets.only(left: 34, top: Insets.sm),
                child: _OutfitSuggestion(outfit: message.outfit!),
              ),
          ],
        ),
      ),
    );
  }
}

/// Compact outfit card embedded in the assistant reply, with the remix chips
/// from `POST /ai/remix` wired underneath.
class _OutfitSuggestion extends StatefulWidget {
  const _OutfitSuggestion({required this.outfit});

  final Outfit outfit;

  @override
  State<_OutfitSuggestion> createState() => _OutfitSuggestionState();
}

class _OutfitSuggestionState extends State<_OutfitSuggestion> {
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
      (widget.outfit.itemIds ?? const <String>[]).length >= 2;

  Future<void> _runRemix(String variant) async {
    if (_busy != null) return;
    setState(() => _busy = variant);
    final result = await AppState.instance.remixOutfit(
      widget.outfit.itemIds ?? const <String>[],
      variant,
    );
    if (!mounted) return;
    setState(() {
      _busy = null;
      // A null result means the backend is unreachable; keep showing the
      // original look rather than blanking the card.
      if (result != null) _remixed = result;
    });
  }

  @override
  Widget build(BuildContext context) {
    final outfit = _remixed ?? widget.outfit;
    final isRemix = _remixed != null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SwCard(
          padding: EdgeInsets.zero,
          clip: true,
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => PerfectMatchScreen(outfit: outfit),
            ),
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

/// The "match a photo of an outfit" result (`POST /ai/match-outfit`):
/// per-slot matches, similarity, and the honest list of what is missing.
class _MatchResultCard extends StatelessWidget {
  const _MatchResultCard({required this.match});

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
            _SlotRow(slot: slot),
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
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => PerfectMatchScreen(outfit: match.outfit),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _SlotRow extends StatelessWidget {
  const _SlotRow({required this.slot});

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

/// Entry point to the Discover feed, which shares this tab in the design.
class _DiscoverLink extends StatelessWidget {
  const _DiscoverLink({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SwCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(
        horizontal: Insets.md,
        vertical: Insets.sm,
      ),
      child: Row(
        children: [
          const SwIconBadge(icon: SwIcon.sparkleCircle, size: 30, iconSize: 16),
          const SizedBox(width: Insets.md),
          Expanded(
            child: Text(
              'Discover trending styles & inspiration',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppText.bodyStrong.copyWith(fontSize: 13),
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

/// Three-dot indicator shown inside the streaming assistant bubble.
class _TypingDots extends StatefulWidget {
  const _TypingDots();

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
                color: AppColors.textTertiary.withValues(alpha: 0.4 + lift / 8),
                shape: BoxShape.circle,
              ),
            ),
          );
        }),
      ),
    );
  }
}

/// Suggestion chips, the photo-match action and the message input, pinned
/// above the tab bar.
class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.onSend,
    required this.onMatchPhoto,
    this.busy = false,
  });

  final TextEditingController controller;
  final void Function([String?]) onSend;
  final VoidCallback onMatchPhoto;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            Insets.lg,
            Insets.md,
            Insets.lg,
            Insets.md,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                height: 34,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  physics: const BouncingScrollPhysics(),
                  itemCount: MockData.stylistSuggestions.length,
                  separatorBuilder: (_, _) => const SizedBox(width: Insets.sm),
                  itemBuilder: (context, i) {
                    final label = MockData.stylistSuggestions[i];
                    return SwChip(
                      label: label,
                      dense: true,
                      onTap: () => onSend(label),
                    );
                  },
                ),
              ),
              const SizedBox(height: Insets.md),
              Row(
                children: [
                  Tooltip(
                    message: 'Match an outfit photo to your wardrobe',
                    child: GestureDetector(
                      onTap: busy ? null : onMatchPhoto,
                      child: Container(
                        width: 46,
                        height: 46,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: AppColors.iconTint,
                          shape: BoxShape.circle,
                          border: Border.all(color: AppColors.border),
                        ),
                        child: const SwIconView(
                          SwIcon.camera,
                          size: 19,
                          color: AppColors.primary,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: Insets.sm),
                  Expanded(
                    child: TextField(
                      controller: controller,
                      style: AppText.field,
                      cursorColor: AppColors.primary,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (v) => onSend(),
                      decoration: const InputDecoration(
                        hintText: 'Ask your personal stylist...',
                        contentPadding: EdgeInsets.symmetric(
                          horizontal: Insets.lg,
                          vertical: Insets.md,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: Insets.sm),
                  GestureDetector(
                    onTap: busy ? null : () => onSend(),
                    child: Container(
                      width: 46,
                      height: 46,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: busy
                            ? AppColors.primary.withValues(alpha: 0.35)
                            : AppColors.primary,
                        shape: BoxShape.circle,
                      ),
                      child: const SwIconView(
                        SwIcon.send,
                        size: 19,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
