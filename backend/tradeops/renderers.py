from rest_framework.renderers import JSONRenderer

class PayloadRenderer(JSONRenderer):
    def render(self, data, accepted_media_type=None, renderer_context=None):
        if data is not None and not (isinstance(data, dict) and 'payload' in data):
            data = {'payload': data}
        return super().render(data, accepted_media_type, renderer_context)