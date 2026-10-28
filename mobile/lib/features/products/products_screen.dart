import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/models.dart';
import '../../core/network/api_client.dart';
import '../../core/widgets.dart';
import '../cart/cart_controller.dart';
import 'product_details_screen.dart';

class ProductsScreen extends StatefulWidget {
  const ProductsScreen({super.key});

  @override
  State<ProductsScreen> createState() => _ProductsScreenState();
}

class _ProductsScreenState extends State<ProductsScreen> {
  final _scroll = ScrollController();
  final _search = TextEditingController();
  Timer? _debounce;

  List<Category> _categories = [];
  String? _categoryId;
  String _sort = 'newest';
  final List<Product> _products = [];
  int _page = 0;
  int _totalPages = 1;
  bool _loading = false;
  Object? _error;

  late final ApiClient _api = context.read<ApiClient>();

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 300) _loadMore();
    });
    _api.get<List<dynamic>>('/categories').then((list) {
      if (mounted) setState(() => _categories = list.map((c) => Category.fromJson(c)).toList());
    }).catchError((_) {});
    _reload();
  }

  @override
  void dispose() {
    _scroll.dispose();
    _search.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _reload() async {
    _products.clear();
    _page = 0;
    _totalPages = 1;
    _error = null;
    await _loadMore();
  }

  Future<void> _loadMore() async {
    if (_loading || _page >= _totalPages) return;
    setState(() => _loading = true);
    try {
      final res = await _api.get<Map<String, dynamic>>('/products', query: {
        'page': _page + 1,
        'limit': 10,
        'sort': _sort,
        if (_search.text.trim().isNotEmpty) 'search': _search.text.trim(),
        if (_categoryId != null) 'categoryId': _categoryId,
      });
      final page = Paged.fromJson(res, Product.fromJson);
      setState(() {
        _products.addAll(page.items);
        _page = page.page;
        _totalPages = page.totalPages;
      });
    } catch (e) {
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Shop'),
        actions: [
          PopupMenuButton<String>(
            icon: const Icon(Icons.sort),
            initialValue: _sort,
            onSelected: (v) {
              _sort = v;
              _reload();
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'newest', child: Text('Newest')),
              PopupMenuItem(value: 'price_asc', child: Text('Price: low to high')),
              PopupMenuItem(value: 'price_desc', child: Text('Price: high to low')),
              PopupMenuItem(value: 'name', child: Text('Name')),
            ],
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(112),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: TextField(
                  controller: _search,
                  decoration: InputDecoration(
                    hintText: 'Search products',
                    prefixIcon: const Icon(Icons.search),
                    filled: true,
                    isDense: true,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(30), borderSide: BorderSide.none),
                  ),
                  onChanged: (_) {
                    _debounce?.cancel();
                    _debounce = Timer(const Duration(milliseconds: 400), _reload);
                  },
                ),
              ),
              SizedBox(
                height: 48,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  children: [
                    _chip(null, 'All'),
                    for (final c in _categories) _chip(c.id, c.name),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
      body: RefreshIndicator(onRefresh: _reload, child: _body()),
    );
  }

  Widget _chip(String? id, String label) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: ChoiceChip(
          label: Text(label),
          selected: _categoryId == id,
          onSelected: (_) {
            _categoryId = id;
            _reload();
          },
        ),
      );

  Widget _body() {
    if (_error != null && _products.isEmpty) return ErrorView(_error!, onRetry: _reload);
    if (_products.isEmpty && _loading) return const Center(child: CircularProgressIndicator());
    if (_products.isEmpty) {
      return ListView(children: const [SizedBox(height: 120), EmptyView(icon: Icons.search_off, text: 'No products found')]);
    }
    return GridView.builder(
      controller: _scroll,
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(12),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2, childAspectRatio: 0.68, crossAxisSpacing: 12, mainAxisSpacing: 12),
      itemCount: _products.length + (_page < _totalPages ? 1 : 0),
      itemBuilder: (_, i) => i >= _products.length ? const Center(child: CircularProgressIndicator()) : _ProductCard(_products[i]),
    );
  }
}

class _ProductCard extends StatelessWidget {
  const _ProductCard(this.product);

  final Product product;

  @override
  Widget build(BuildContext context) {
    final inCart = context.watch<CartController>().quantityOf(product.id);
    final out = product.stock == 0;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ProductDetailsScreen(product))),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: SizedBox(width: double.infinity, child: ProductImage(product.image, radius: 0))),
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(product.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 2),
                  Text(product.category?.name ?? '', style: TextStyle(fontSize: 11, color: Colors.grey.shade600)),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 0, 4, 4),
              child: Row(
                children: [
                  Expanded(
                    child: Text(money(product.price), style: TextStyle(fontWeight: FontWeight.bold, color: Theme.of(context).colorScheme.primary)),
                  ),
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    onPressed: out || inCart >= product.stock
                        ? null
                        : () {
                            context.read<CartController>().add(product);
                            showSuccess('Added ${product.name} to cart');
                          },
                    icon: Badge(
                      isLabelVisible: inCart > 0,
                      label: Text('$inCart'),
                      child: Icon(out ? Icons.remove_shopping_cart_outlined : Icons.add_shopping_cart),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
