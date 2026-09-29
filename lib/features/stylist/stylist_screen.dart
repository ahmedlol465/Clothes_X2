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
      _thinking = true;
    });
    _input.clear();
    _scrollToEnd();

    // Wardrobe-aware reply from the backend (§8.4 POST /ai/chat),
    // with the bundled replies as the offline fallback.
    final reply = await AppState.instance.askStylist(text);
    if (!mounted) return;
    setState(() {
      _thinking = false;
      _messages.add(
        ChatMessage(fromUser: false, text: reply.text, outfit: reply.outfit),
      );
    });
    _scrollToEnd();
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
              itemCount: _messages.length + (_thinking ? 1 : 0),
              itemBuilder: (context, i) {
                if (i >= _messages.length) return const _TypingBubble();
                final message = _messages[i];
                return Padding(
                  padding: const EdgeInsets.only(bottom: Insets.md),
                  child: _Bubble(message: message),
                );
              },
            ),
          ),
          _Composer(controller: _input, onSend: _send),
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
                    child: Text(
                      message.text,
                      style: AppText.body.copyWith(
                        color: AppColors.textPrimary,
                        fontSize: 13,
                      ),
                    ),
                  ),
                ),
              ],
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

/// Compact outfit card embedded in the assistant reply.
class _OutfitSuggestion extends StatelessWidget {
  const _OutfitSuggestion({required this.outfit});

  final Outfit outfit;

  @override
  Widget build(BuildContext context) {
    return SwCard(
      padding: EdgeInsets.zero,
      clip: true,
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => PerfectMatchScreen(outfit: outfit)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            height: 130,
            width: double.infinity,
            child: Image.asset(outfit.image, fit: BoxFit.cover),
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
        ],
      ),
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

class _TypingBubble extends StatelessWidget {
  const _TypingBubble();

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Row(
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
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: Insets.lg,
              vertical: Insets.md,
            ),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(Radii.xl),
              border: Border.all(color: AppColors.border),
            ),
            child: const _TypingDots(),
          ),
        ],
      ),
    );
  }
}

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

/// Suggestion chips plus the message input, pinned above the tab bar.
class _Composer extends StatelessWidget {
  const _Composer({required this.controller, required this.onSend});

  final TextEditingController controller;
  final void Function([String?]) onSend;

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
                    onTap: () => onSend(),
                    child: Container(
                      width: 46,
                      height: 46,
                      alignment: Alignment.center,
                      decoration: const BoxDecoration(
                        color: AppColors.primary,
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
