import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../app.dart';
import '../../core/app_copy.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/widgets/sw_screen.dart';
import '../../data/app_state.dart';
import '../../data/controllers/stylist_controller.dart';
import '../../data/models.dart';
import 'widgets.dart';

/// Frame 12 - conversational styling assistant.
class StylistScreen extends StatefulWidget {
  const StylistScreen._(this._stylistController);

  factory StylistScreen({
    Key? key,
    StylistController? stylistController,
  }) {
    return StylistScreen._(
      stylistController ?? AppState.instance.stylistController,
    );
  }

  final StylistController _stylistController;

  @override
  State<StylistScreen> createState() => _StylistScreenState();
}

class _StylistScreenState extends State<StylistScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  late final List<ChatMessage> _messages;
  bool _thinking = false;

  @override
  void initState() {
    super.initState();
    _messages = [
      ChatMessage(
        fromUser: false,
        text: AppCopy.stylistGreeting(AppState.instance.profile?.name),
      ),
    ];
  }

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
      _messages.add(ChatMessage(fromUser: false, text: ''));
      _thinking = true;
    });
    _input.clear();
    _scrollToEnd();

    final reply = await widget._stylistController.stream(
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

    final match = await widget._stylistController.matchPhoto(
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
          const StylistHeader(),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              Insets.gutter,
              Insets.md,
              Insets.gutter,
              0,
            ),
            child: DiscoverLink(
              onTap: () => Navigator.of(context).pushNamed(Routes.discover),
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
                  child: Bubble(message: message),
                );
              },
            ),
          ),
          Composer(
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