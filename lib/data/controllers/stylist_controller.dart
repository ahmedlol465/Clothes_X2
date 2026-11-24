import 'package:flutter/foundation.dart';

import '../../core/api/smartwardrobe_api.dart';
import '../backend_status.dart';
import '../models.dart';
import '../dto/mappers.dart';

/// Chat, streaming replies, photo matching and learned style DNA.
class StylistController extends ChangeNotifier {
  StylistController({
    required SmartWardrobeApi api,
    required BackendStatus status,
  })  : _api = api,
        _status = status;

  final SmartWardrobeApi _api;
  final BackendStatus _status;

  String? _conversationId;
  final List<Map<String, dynamic>> _history = [];

  String? styleDnaSummary;
  double styleDnaConfidence = 0;

  String? get conversationId => _conversationId;

  void resetConversation() {
    _conversationId = 'c${DateTime.now().millisecondsSinceEpoch}';
    _history.clear();
  }

  List<Map<String, dynamic>> chatHistory({int limit = 12}) {
    if (_history.length <= limit) {
      return [for (final t in _history) Map<String, dynamic>.from(t)];
    }
    return [
      for (final t in _history.sublist(_history.length - limit))
        Map<String, dynamic>.from(t),
    ];
  }

  Future<({String text, Outfit? outfit})> ask(
    String message, {
    bool useHistory = true,
  }) async {
    try {
      final res = await _api.chat(
        message,
        history: useHistory ? chatHistory() : const [],
        conversationId: _conversationId,
      );
      final text = '${res['reply'] ?? ''}';
      final outfit = res['outfit'] is Map
          ? outfitFromJson(Map<String, dynamic>.from(res['outfit'] as Map))
          : null;
      _recordTurn(message, text);
      _applyMemory(res['memory']);
      _status.markOnline();
      return (text: text, outfit: outfit);
    } catch (e) {
      _status.markOffline(e);
      final text = _unavailableReply();
      _recordTurn(message, text);
      return (text: text, outfit: null);
    }
  }

  Future<
      ({
        String text,
        Outfit? outfit,
        String source,
        Map<String, dynamic>? outfitRaw,
        String? followUp,
        List<String> suggestions,
      })>
      stream(
    String message, {
    required void Function(String partial) onDelta,
  }) async {
    try {
      var text = '';
      Map<String, dynamic>? done;
      await for (final frame in _api.chatStream(
        message,
        history: chatHistory(),
        conversationId: _conversationId,
      )) {
        switch (frame.event) {
          case 'delta':
            final delta = '${frame.data['delta'] ?? ''}';
            if (delta.isEmpty) break;
            text += delta;
            onDelta(text);
          case 'notice':
            // The LLM was busy; the server falls back to the rule engine and
            // still delivers a complete reply via `delta` + `done`.
            break;
          case 'error':
            // Terminal: no reply is coming for this turn.
            break;
          case 'done':
            done = frame.data;
        }
      }
      final payload = done ?? {'reply': text};
      final finalText = '${payload['reply'] ?? text}';
      final outfit = payload['outfit'] is Map
          ? outfitFromJson(Map<String, dynamic>.from(payload['outfit'] as Map))
          : null;
      if (finalText.isNotEmpty && finalText != text) onDelta(finalText);
      _recordTurn(message, finalText);
      _applyMemory(payload['memory']);
      _status.markOnline();
      return (
        text: finalText,
        outfit: outfit,
        source: '${payload['source'] ?? 'rules'}',
        outfitRaw: payload['outfit'] is Map
            ? Map<String, dynamic>.from(payload['outfit'] as Map)
            : null,
        followUp: payload['followUp'] is String
            ? payload['followUp'] as String
            : null,
        suggestions: (payload['suggestions'] as List?)
                ?.map((value) => '$value')
                .where((value) => value.trim().isNotEmpty)
                .toList() ??
            const <String>[],
      );
    } catch (e) {
      _status.markOffline(e);
      final text = _unavailableReply();
      _recordTurn(message, text);
      onDelta(text);
      return (
        text: text,
        outfit: null,
        source: 'error',
        outfitRaw: null,
        followUp: null,
        suggestions: const <String>[],
      );
    }
  }

  Future<OutfitMatch?> matchPhoto({
    List<int>? bytes,
    String? dataUrl,
    String mimeType = 'image/jpeg',
    String filename = 'reference.jpg',
    String note = '',
  }) async {
    try {
      final res = await _api.matchOutfit(
        imageBytes: bytes,
        dataUrl: dataUrl,
        mimeType: mimeType,
        filename: filename,
        note: note,
      );
      _status.markOnline();
      return outfitMatchFromJson(res);
    } catch (e) {
      _status.markOffline(e);
      return null;
    }
  }

  Future<void> loadStyleDna() async {
    try {
      final res = await _api.styleDna();
      final dna = res['digest'];
      _status.markOnline();
      if (dna is Map) {
        styleDnaSummary = _describe(Map<String, dynamic>.from(dna));
        styleDnaConfidence =
            ((res['styleDna'] as Map?)?['confidence'] as num?)?.toDouble() ?? 0;
        notifyListeners();
      }
    } catch (e) {
      _status.markOffline(e);
    }
  }

  String _describe(Map<String, dynamic> digest) {
    final parts = <String>[
      for (final entry in [
        ('Dislikes', digest['dislikes']),
        ('Prefers', digest['prefers']),
        ('Notes', digest['notes']),
      ])
        if (entry.$2 != null && '${entry.$2}'.trim().isNotEmpty)
          '${entry.$1}: ${entry.$2}',
    ];
    if (parts.isEmpty) return 'Still learning your taste — rate a few looks.';
    return parts.join(' · ');
  }

  void _recordTurn(String message, String reply) {
    _history.add({'fromUser': true, 'text': message});
    _history.add({'fromUser': false, 'text': reply});
    if (_history.length > 60) {
      _history.removeRange(0, _history.length - 60);
    }
  }

  void _applyMemory(Object? memory) {
    if (memory is! Map) return;
    final digest = memory['digest'];
    if (digest is Map) {
      styleDnaSummary = _describe(Map<String, dynamic>.from(digest));
    }
    styleDnaConfidence =
        (memory['confidence'] as num?)?.toDouble() ?? styleDnaConfidence;
  }

  String _unavailableReply() {
    final detail = _status.lastError;
    if (detail == null || detail.trim().isEmpty) {
      return 'I could not reach the stylist service. Check the backend and try again.';
    }
    return 'I could not reach the stylist service ($detail). Try again in a moment.';
  }

  void reset() {
    styleDnaSummary = null;
    styleDnaConfidence = 0;
    _history.clear();
    _conversationId = null;
    resetConversation();
  }
}
