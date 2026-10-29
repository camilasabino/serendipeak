from serendipeak.errors import ApplicationError


class InvalidCatalogSeed(ApplicationError):
    pass


class InvalidFrozenCatalog(ApplicationError):
    pass


class CatalogAlreadyPopulated(ApplicationError):
    def __init__(self):
        super().__init__("the catalog already holds mountains")


class CatalogMismatch(ApplicationError):
    def __init__(self, mismatches: tuple[str, ...]):
        super().__init__("; ".join(mismatches))
        self.mismatches = mismatches


class MountainNotFound(ApplicationError):
    def __init__(self, slug: str):
        super().__init__(f"no public mountain has the slug {slug!r}")
        self.slug = slug
