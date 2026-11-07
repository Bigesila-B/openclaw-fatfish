import asyncio
import json
import sys


async def main():
    import edge_tts

    request = json.load(sys.stdin)
    await edge_tts.Communicate(request["text"], request["voice"]).save(request["output"])


if __name__ == "__main__":
    asyncio.run(main())
