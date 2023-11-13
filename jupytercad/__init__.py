from ._version import __version__  # noqa
from .cadapp import CadApp

from .notebook import *  # noqa


def _jupyter_server_extension_points():
    return [{"module": __name__, "app": CadApp}]
