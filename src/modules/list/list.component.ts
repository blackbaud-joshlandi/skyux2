import {
  Component,
  ContentChildren,
  QueryList,
  AfterContentInit,
  ChangeDetectionStrategy,
  Input,
  Output,
  EventEmitter
} from '@angular/core';

import {
  ListItemsLoadAction, ListItemsSetLoadingAction
} from './state/items/actions';

import {
  ListSelectedLoadAction,
  ListSelectedSetLoadingAction
} from './state/selected/actions';

import {
  ListSelectedModel
} from './state/selected/selected.model';

import {
  AsyncItem
} from 'microedge-rxstate/dist';

import { ListDataRequestModel } from './list-data-request.model';
import { ListDataResponseModel } from './list-data-response.model';
import { ListDataProvider } from './list-data.provider';
import { SkyListInMemoryDataProvider } from '../list-data-provider-in-memory';
import { ListState, ListStateDispatcher } from './state';
import { Observable } from 'rxjs/Observable';
import { ListViewComponent } from './list-view.component';

import { ListSearchModel } from './state/search/search.model';

import {
  ListViewsLoadAction,
  ListViewsSetActiveAction
} from './state/views/actions';

import { ListViewModel } from './state/views/view.model';
import { ListItemModel } from './state/items/item.model';

import { isObservable } from './helpers';
let moment = require('moment');

@Component({
  selector: 'sky-list',
  template: '<ng-content></ng-content>',
  providers: [ListState, ListStateDispatcher],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SkyListComponent implements AfterContentInit {
  public id: string = moment().toDate().getTime().toString();
  @Input()
  public data?: Array<any> | Observable<Array<any>> = [];

  @Input()
  public dataProvider?: ListDataProvider;

  @Input()
  public defaultView?: ListViewComponent;

  @Input()
  public initialTotal?: number;

  @Input()
  public selectedIds?: Array<string> | Observable<Array<string>>;

  @Input()
  public sortFields?: string | Array<string> | Observable<Array<string>> | Observable<string>;

  @Output()
  public selectedIdsChange = new EventEmitter<Map<string, boolean>>();

  /* tslint:disable */
  @Input('search')
  private searchFunction: (data: any, searchText: string) => boolean;
  /* tslint:enable */

  private dataFirstLoad: boolean = false;

  @ContentChildren(ListViewComponent)
  private listViews: QueryList<ListViewComponent>;

  constructor(
    private state: ListState,
    private dispatcher: ListStateDispatcher
  ) {}

  public ngAfterContentInit() {
    if (this.data && this.dataProvider && this.initialTotal) {
      this.dataFirstLoad = true;
    }

    if (this.listViews.length > 0) {
      let defaultView: ListViewComponent =
        (this.defaultView === undefined) ? this.listViews.first : this.defaultView;

      this.dispatcher.next(
        new ListViewsLoadAction(this.listViews.map(v => new ListViewModel(v.id, v.label)))
      );

      // activate the default view
      this.dispatcher.next(new ListViewsSetActiveAction(defaultView.id));
    } else {
      return;
    }

    this.displayedItems.subscribe(result => {
      this.dispatcher.next(new ListItemsSetLoadingAction());
      this.dispatcher.next(new ListItemsLoadAction(result.items, true, true, result.count));
    });

    // Emit new selected items when they change if there is an observer.
    if (this.selectedIdsChange.observers.length > 0) {

      this.state.map(current => current.selected).distinctUntilChanged()
        .skip(1)
        .subscribe((selected) => {
          this.selectedIdsChange.emit(selected.item.selectedIdMap);
        });
    }

  }

  public refreshDisplayedItems(): void {
    this.displayedItems.take(1).subscribe(result => {
      this.dispatcher.next(new ListItemsSetLoadingAction());
      this.dispatcher.next(new ListItemsLoadAction(result.items, true, true, result.count));
    });
  }

  get displayedItems(): Observable<ListDataResponseModel> {
    if (!this.data && !this.dataProvider) {
      throw new Error('List requires data or dataProvider to be set.');
    }

    let data: any = this.data;
    if (!isObservable(data)) {
      data = Observable.of(this.data);
    }

    if (!this.dataProvider) {
      this.dataProvider = new SkyListInMemoryDataProvider(data, this.searchFunction);
    }

    let selectedIds: any = this.selectedIds || Observable.of([]);
    if (!isObservable(selectedIds)) {
      selectedIds = Observable.of(selectedIds);
    }

    let selectedChanged: boolean = false;

    return Observable.combineLatest(
      this.state.map(s => s.search).distinctUntilChanged(),
      this.state.map(s => s.paging.itemsPerPage).distinctUntilChanged(),
      this.state.map(s => s.paging.pageNumber).distinctUntilChanged(),
      selectedIds.distinctUntilChanged().map((selectedId: any) => {
        selectedChanged = true;
        return selectedId;
      }),
      data.distinctUntilChanged(),
      (
        search: ListSearchModel,
        itemsPerPage: number,
        pageNumber: number,
        selected: Array<string>,
        itemsData: Array<any>
      ) => {

        if (selectedChanged) {
          this.dispatcher.next(new ListSelectedSetLoadingAction());
          this.dispatcher.next(new ListSelectedLoadAction(selected));
          this.dispatcher.next(new ListSelectedSetLoadingAction(false));
          selectedChanged = false;
        }

        let response: Observable<ListDataResponseModel>;
        if (this.dataFirstLoad) {
          this.dataFirstLoad = false;
          let initialItems = itemsData.map(d =>
            new ListItemModel(d.id || moment().toDate().getTime().toString(), d));
          response = Observable.of(new ListDataResponseModel({
            count: this.initialTotal,
            items: initialItems
          }));
        } else {
          response = this.dataProvider.get(new ListDataRequestModel({
            pageSize: itemsPerPage,
            pageNumber: pageNumber,
            search: search
          }));
        }

        return response;
      }).flatMap((value: Observable<ListDataResponseModel>, index: number) => {
        return value;
      });
  }

  public get selectedItems(): Observable<Array<ListItemModel>> {
    return Observable.combineLatest(
      this.state.map(current => current.items.items).distinctUntilChanged(),
      this.state.map(current => current.selected).distinctUntilChanged(),
      (items: Array<ListItemModel>, selected: AsyncItem<ListSelectedModel>) => {
        return items.filter(i => selected.item.selectedIdMap.get(i.id));
      }
    );
  }

  public get lastUpdate() {
    return this.state.map(s =>
      s.items.lastUpdate ? moment(s.items.lastUpdate).toDate() : undefined
    );
  }

  public get views() {
    return this.listViews.toArray();
  }

  public get itemCount() {
    return this.dataProvider.count();
  }
}
