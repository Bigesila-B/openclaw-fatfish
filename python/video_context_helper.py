"""Isolated adapter for the vendored Video Context Builder (MIT)."""
import json
import os
import sys
from pathlib import Path

os.environ['FATFISH_RESTRICT_MEDIA'] = '1'
scripts = Path(__file__).resolve().parents[1] / 'vendor' / 'video-context-builder' / 'scripts'
sys.path.insert(0, str(scripts))
from probe_video import probe_video
from build_video_context import build_video_context


def main():
    payload = json.load(sys.stdin)
    video = payload['video']
    meta = probe_video(video)
    if meta['duration'] > payload['maxDurationSeconds']:
        raise ValueError('视频时长超过管理员设定的上限。')
    stt = payload['stt']
    opts = {'video_path': video, 'mode': 'auto', 'stt': stt['mode'] != 'off',
            'max_tokens': payload['maxTokens'], 'question': payload['question'],
            'out': payload['output'], 'out_dir': payload['assets'],
            'max_frames': 72, 'progress': False}
    if stt['mode'] == 'local':
        opts.update(stt_backend='local', whisper_model=stt['model'])
    elif stt['mode'] == 'api':
        opts.update(stt_backend='api', stt_api_options={
            'base_url': stt['baseUrl'], 'model': stt['model'],
            'api_key_env': stt['keyEnv'], 'response_format': stt['responseFormat'],
            'timeout': 120, 'chunk_seconds': 300, 'max_upload_mb': 20,
        })
    result = build_video_context(**opts)
    if not result['budget']['ready_to_send']:
        raise ValueError('视频材料超过预算或没有有效画面，未交给模型。')
    print(json.dumps({'ok': True}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # No paths, signed URLs, audio, transcript or environment values in logs.
        safe = '视频时长超过管理员设定的上限。' if str(exc) == '视频时长超过管理员设定的上限。' else '视频处理失败或超出预算，请检查文件格式、依赖和配置。'
        print(json.dumps({'ok': False, 'error': safe}, ensure_ascii=False))
        sys.exit(1)
